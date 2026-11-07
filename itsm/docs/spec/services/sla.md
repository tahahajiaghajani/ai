# The SLA service: calendars, SLAs, approvals and the rules of records

One platform service on top of the record engine (docs/spec/ENGINE.md), the access model (docs/spec/ACCESS.md) and the
record UI kit (docs/spec/UI_RECORDS.md). Every piece of configuration is an ordinary engine record — generic lists and
forms, history, audit, sync and permissions come for free — and every behaviour is an engine hook, so it applies on
every write path (API, imports, flows, jobs, a Windows app's own writes).

Contents: [1 Layout](#1-layout) · [2 Calendars and holidays](#2-calendars-and-holidays) · [3 SLAs](#3-slas) ·
[4 Approvals](#4-approvals) · [5 Rules of records](#5-rules-of-records) · [6 HTTP API](#6-http-api) ·
[7 Screens](#7-screens) · [8 Extension points for modules](#8-extension-points-for-modules) · [9 Testing](#9-testing)

---

## 1. Layout

| path | what |
| --- | --- |
| `src/shared/tables/sla.ts` | `calendar`, `holiday`, `sla_definition`, `task_sla` (+ `SLA_SERVICE_TABLES`, listed once in `MODULE_TABLES`) |
| `src/shared/tables/approvals.ts` | `approval_rule`, `approval`, `delegation` |
| `src/shared/tables/rules.ts` | `business_rule`, `assignment_rule`, `priority_matrix`, `category`, `ui_policy` |
| `src/shared/sla/calendar.ts` | business-time arithmetic (pure, shared by server and UI) |
| `src/shared/sla/timer.ts` | SLA timer maths: state, thresholds, due events, targets |
| `src/shared/sla/approvals.ts` | approval maths: `needed`, `levelOutcome`, `roundOutcome`, `aggregate`, `levelsProblem` |
| `src/shared/sla/rules.ts`, `policy-types.ts` | ITIL matrix, business-rule actions, stored UI policies → `UiPolicy` |
| `src/server/modules/sla/` | `calendars.ts`, `sla.ts`, `approvals.ts`, `rules.ts`, `policies.ts`, `common.ts` (config cache, `liveRows`), `holidays-ir.ts` (bundled holidays), `index.ts` (`installSlaService()`) |
| `src/server/routes/sla.ts` | `/calendars`, `/sla`, `/approvals`, `/rules` (mounted in `routes/modules.ts`) |
| `src/ui/modules/sla/` | screens (§7); pure logic in `model.ts` |

`installSlaService()` (called once in `routes/modules.ts`) registers hooks on every table (`"*"`) in a fixed order:

```
beforeWrite  priority matrix → categories → business rules (before) → assignment rules → UI policies
             → approvals (the `approval` field) → SLA timers (`sla_due`)        each sees what the previous ones set
afterWrite   SLA timers → approval rows → business rules (after)               nested writes of rules see both applied
```

None of this applies to the service's own tables (`ownTable()`: calendars, holidays, definitions, timers, approval
rules, approvals, delegations and the rule tables).

The organisation's configuration (rules, policies, matrices, categories, definitions, approval rules, calendars,
holidays) is read through `config(q, ctx)`: cached per process and revalidated on every use by one small query (count
and last change of each table), so a change made on another cloud instance is seen at once.

## 2. Calendars and holidays

### Tables

- `calendar` — `name`, `timezone` (IANA, default `Asia/Tehran`), `hours` (JSON: seven lists, Saturday first, of
  `["HH:MM", "HH:MM"]`; an end before the start is an overnight shift belonging to the day it starts), `holiday_sets`
  (choice list `holiday.set`: `ir` official, `org` the organisation's; organisations may add sets), `is_default` (one
  per organisation — setting it clears the others), `active`. Checked with `hoursProblem` (≤ 12 intervals a day, no
  overlap, valid times, `24:00` only as an end).
- `holiday` — `date`, `title`, `holiday_set`, `half_day` (only the first half of that day's working time counts),
  `kind` (solar / lunar / org / other), `predicted` (a lunar date not yet in an official calendar),
  `alternative_date`, `hijri`, `note`, `year` (Jalali, filled by a hook), `source` (bundled / manual), `active`.
  Unique per (`holiday_set`, `date`). Every holiday is editable by the organisation.

### Bundled official holidays

`holidays-ir.ts` carries the official Iranian holidays of 1404–1406 (only the per-year lists of the research file;
its `special_closures` are not imported). The lunar dates of 1406 are `predicted: true` (two with an
`alternative`); the holidays page marks them «پیش‌بینی» with a «تأیید» action.

A new organisation gets, by the job `sla.seed` (queued by `registerOrgSeed` with `SEED_DELAY_MS` = 10 minutes so
sign-up stays fast), two calendars — «ساعات اداری» (Saturday–Wednesday 08:00–16:00, Thursday 08:00–12:00, Friday off,
set `ir`, default) and «شبانه‌روزی» (24 × 7) — and the bundled years. Seeding is idempotent per Jalali year and never
re-adds a year the organisation already has (or deleted on purpose). `POST /calendars/seed { years }` runs it on demand.

### Business-time arithmetic (`@shared/sla/calendar`)

```ts
const cal = calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, [{ date: "2026-03-21", title: "نوروز" }, { date: "2026-03-19", half_day: true }]);
addBusiness(cal, start, 2 * HOUR);   // the instant two working hours after `start` (null: the week has no working time)
businessBetween(cal, a, b);          // working milliseconds between two instants
workingIntervals(cal, a, b);         // the working stretches [from, to][] between them
isWorking(cal, t); nextWorkingInstant(cal, t);
addBusiness(null, start, d) === start + d   // no calendar = 24 × 7
```

Local times are resolved in the calendar's zone (`localInstant`, `midnightOf`; a wall time inside a skipped DST hour
moves forward; Asia/Tehran has no DST). Holidays remove whole days (an overnight shift starting on a holiday is
removed whole); a half day keeps the first half of its working minutes. The algebra `businessBetween(s, addBusiness(s,
d)) = d` holds and is tested exhaustively (tests/sla-calendar.test.ts).

### The holiday source of the record UI

`setHolidaySource` is wired to `GET /calendars/holidays?from&to[&calendar]` — the holidays of the sets of the default
calendar (or the given one). `CalendarView` and `TimelineView` shade them.

## 3. SLAs

### `sla_definition`

| field | meaning |
| --- | --- |
| `table_key` | the table whose records it times |
| `type` | `sla` / `ola` / `uc` |
| `target` | `response` / `resolution` / `custom` |
| `duration_mode`, `duration`, `durations`, `priority_field` | fixed seconds, or seconds per priority value (`{ "1": 3600, … }`; a priority without a target attaches nothing) |
| `calendar_id`, `timezone_source` | working calendar (empty = 24 × 7); zone from the calendar, the organisation, the requester's profile or the record's location |
| `start_condition`, `pause_condition`, `stop_condition`, `reset_condition`, `cancel_condition` | conditions on the record (rule operators `changed`, `changes_to`, `changes_from` allowed); an empty start = always |
| `retroactive`, `retroactive_field` | start from a datetime field of the record (e.g. `opened_at`) instead of now |
| `warn_percents` | warning thresholds, e.g. `[50, 75, 90]` |
| `breach_actions` | `[{ type: "notify", users?, groups?, fields?, roles?, message? }, { type: "escalate", level? }, { type: "set", field, value }, { type: "reassign", group_id?, user_id? }]` |
| `service_id`, `customer_unit_id`, `workspace_id` | scope: only records of that service, customer unit (or below) and workspace |

```json
{ "name": "حل رخداد", "table_key": "incident", "type": "sla", "target": "resolution",
  "duration_mode": "priority", "durations": { "1": 14400, "2": 28800, "3": 86400 },
  "calendar_id": "<«ساعات اداری»>", "pause_condition": { "f": "state", "op": "eq", "v": "on_hold" },
  "stop_condition": { "f": "state", "op": "in", "v": ["resolved", "closed"] },
  "cancel_condition": { "f": "state", "op": "eq", "v": "canceled" },
  "reset_condition": { "f": "assignment_group_id", "op": "changed" },
  "warn_percents": [50, 75, 90], "breach_actions": [{ "type": "escalate" }, { "type": "notify", "fields": ["assigned_to"] }] }
```

### `task_sla` (written by the engine only; API writes are refused)

`definition_id`, `table_key`, `record_id`, `record_number`, `name`, `type`, `target`, `stage` (`in_progress` /
`paused` / `achieved` / `breached` / `canceled`), `active`, `breached`, `start_at`, `pause_started_at`, `paused_total`
(working seconds paused), `duration` (target), `business_elapsed`, `planned_end_at`, `stop_at`, `breached_at`,
`percent`, `warned` (highest threshold announced), `calendar_id`, `timezone`, `computed_at`.

### Lifecycle (inside the write's transaction, every write path)

| situation | result |
| --- | --- |
| no timer of a definition + start condition (and scope) | attach; `start_at` = now or the retroactive field |
| live timer + cancel condition | `canceled` |
| live timer + reset condition | canceled, and a new timer attached |
| live timer + stop condition | `achieved`, or `breached` when past the deadline (the breach is announced, `at_stop: true`) |
| live timer + pause condition on / off | `paused` / resumed; paused working time is not counted |
| live timer whose target changes (priority) | repaired: duration and `planned_end_at` recomputed |

The record's `sla_due` (task tables) follows the earliest deadline of its running timers. Changing a calendar or a
holiday queues `sla.recalc`, which recomputes the deadlines of live timers.

### Warnings and breaches, exactly once

Each live timer has one job `sla.timer` (dedupe key `sla.timer:<id>`) scheduled for its next threshold or deadline.
The job locks the timer row, computes `dueEvents` (pure), records the highest threshold reached (`warned`) and the
breach (`breached`, `breached_at`) and, in the same transaction, emits

- `record.sla_warning` — `data: { task_sla_id, definition_id, name, type, target, stage, start_at, planned_end_at, percent, threshold }`
- `record.sla_breach` — the same plus `breached_at`, `at_stop`, `notify` (the definition's notify actions)

and runs the breach actions (escalate, set, reassign — one write of the record — and a system journal entry). A
timer that jumps past several thresholds announces only the highest. A Windows app linked to the cloud leaves warnings
and breaches to the cloud (its timers travel there).

### Read side

- `meta.sla` on `GET /r/:table/:id`: the record's timers in the shape of UI_RECORDS.md §10 — `{ id, label, type,
  target, state, start_at, due_at, stop_at, paused, breached, met, percent, remaining_ms, elapsed_ms, duration_ms }`
  (computed lazily on read).
- `GET /sla/records/:table/:id` → `{ timers: [{ …timer, events: [{ at, kind: start|pause|resume|warning|breach|stop|cancel|repair, label, detail? }] }] }`
  (the record must be readable by the caller).

## 4. Approvals

### `approval_rule`

| field | meaning |
| --- | --- |
| `table_key`, `condition` | approvals are requested when the condition **becomes** true on a write (on create, or by a change that makes it hold); a rule with an open round is not asked again |
| `mode` | `sequential` (levels one after another) or `parallel` |
| `levels` | `[{ name?, sources: Source[], rule: any|all|count|percent, threshold? }]` (≤ 10; default: the requester's manager) |
| `auto_approve` | a condition that approves at once (a single approved row, `تأیید خودکار`) |
| `allow_self_approval` | lift separation of duties |
| `remind_every`, `expire_after`, `expire_action` | seconds; after the deadline an open approval is `rejected` (default), `approved` or `canceled` |

Sources: `{ kind: "users", users }`, `{ kind: "groups", groups }` (their valid members), `{ kind: "manager", depth?: 1|2 }`
(the requester's profile manager, else their unit's manager), `{ kind: "field", field }` (a `user`, `users` or `group`
field of the record), `{ kind: "owner", of }` (a source a module registered, §8). Checked by `levelsProblem`.

```json
{ "name": "خرید بالای سقف", "table_key": "purchase", "condition": { "f": "amount", "op": "gte", "v": 500000000 },
  "mode": "sequential", "expire_after": 172800, "remind_every": 86400,
  "levels": [ { "name": "مدیر", "sources": [{ "kind": "manager" }] },
              { "name": "مالی", "sources": [{ "kind": "groups", "groups": ["<مالی>"] }], "rule": "count", "threshold": 2 } ] }
```

### `approval` (one row per approver and level; written by the service only)

`table_key`, `record_id`, `record_number`, `record_title`, `rule_id` (null for ad-hoc), `round`, `level`,
`level_name`, `approver_id`, `group_id`, `source`, `rule`, `threshold`, `state` (`waiting` → `requested` →
`approved` / `rejected` / `canceled` / `skipped` / `no_longer_required`), `comments`, `due_at`, `requested_at`,
`requested_by` (the person whose write or request asked; null for the system), `decided_at`, `decided_by`,
`delegated_from`, `reminded_at`. Readable through the generic API by its approver, the person it was delegated from
and who decided it.

### Semantics

- A level is approved when its rule is met (`any` 1 · `all` n · `count` min(t, n) · `percent` ⌈n·p/100⌉) and rejected
  as soon as it can no longer be; the open rows of a decided level become `no_longer_required`. In sequential mode the
  next level opens (`waiting` → `requested`) only then. A rejected level rejects the round.
- The record's `approval` field (task tables: `not_requested` / `requested` / `approved` / `rejected`) is the aggregate
  over the rules' latest rounds: rejected > requested > approved.
- **Separation of duties**: the requester side (`scope.requester`, else `scope.own` minus the assignee) and the
  assignee never approve, unless the rule allows it — they are left out when the round is built, and `decide` refuses
  them (403) if they became one later. A rule level left with nobody asks the requester's manager; failing that the
  level is `skipped`. Ad-hoc requests get no stand-in (400 when nobody named may approve).
- **Delegation** (`delegation`: `from_user`, `to_user`, `starts_at`, `ends_at`, `scopes` approvals / assignments /
  notifications, `active`; created by the person delegating, who must be able to see the delegate): an absent
  approver's delegate is asked instead (`delegated_from`), and a delegation that starts later lets the delegate decide
  the open approvals on the approver's behalf. Chains are followed up to three steps, never in a circle.
- A record that reaches a done state (resolved, closed, canceled) withdraws its open approvals (`no_longer_required`).
- Reminders and expiry run as the job `approval.timer` (one per record, dedupe key `approval.timer:<table>:<id>`).
- **Read access**: the access model's participant source `approvals` lets an approver (and their delegate) read a
  record of a table with an `approval` field while their approval is `requested`.
- Events: `record.approval_requested` per (rule, round, level) opened — `data: { rule_id, round, level, approval_ids,
  approvers, due_at, adhoc?, reminder? }`; `record.approval_decided` — `data: { approval_id, rule_id, round, level,
  decision: approved|rejected|expired, by, on_behalf_of, comment, outcome }`. A decision on a record with a journal
  adds an `approval` entry.

## 5. Rules of records

### Priority matrix (`priority_matrix`)

One per table: `impact_field`, `urgency_field`, `priority_field` (choice fields) and `cells`
(`{ "<impact>": { "<urgency>": "<priority>" } }`, default the ITIL grid `ITIL_MATRIX`). On create, and whenever impact
or urgency changes (also by a business rule), the priority follows the matrix; an empty cell leaves it as given; a
priority set by hand stays until impact or urgency moves again. An inactive matrix turns the automatism off. Modules
give a table the ITIL default with `registerPriorityDefault(table)` until the organisation defines its own.

### Categories (`category`)

A two-level tree per table (`name`, `value` code, `parent_id`, `default_group_id`, `workspace_id`, `sort_order`,
`active`). The tree is mirrored into the table's choice lists `<table>.category` / `<table>.subcategory` (a renamed
code deactivates the old option; records keep their value). On a record: a category defined for another workspace is
refused; an empty assignment group takes the subcategory's, else the category's default group. A category with
children cannot be deleted (409).

### Business rules (`business_rule`)

`timing` (`before` / `after` the save), `events` (`insert`, `update`, `state_change`), `condition` (rule operators
allowed), `actions`, `sort_order` (ascending; each rule sees the values earlier ones set):

```json
[ { "type": "set", "field": "impact", "value": "1" },
  { "type": "set", "field": "reviewer", "token": "$me" },          // $now, $today, $me, $empty
  { "type": "set", "field": "copied", "from": "short_description" },
  { "type": "watcher", "op": "add", "users": ["<uuid>"], "field": "requested_for" },
  { "type": "work_note", "body": "ثبت شد: {{number}}" },
  { "type": "create", "table": "task", "values": { "short_description": "پیگیری {{short_description}}", "parent_id": "{{id}}" } },
  { "type": "abort", "message": "ثبت پرونده‌های مسدود مجاز نیست" } ]
```

Before the save, `set` and `watcher` change the row being written (the state field only after the save), `work_note`
and `create` are deferred until the row exists, and `abort` refuses the write with its Persian message (400, code
`rule`). After the save, actions run as one trusted write of the record; an `abort` there undoes the whole write.
Nested writes caused by after-rules stop at `MAX_RULE_DEPTH` (3). Templates `{{field}}` fill from the record.

### Assignment rules (`assignment_rule`)

For an open record without a group and an assignee: the first rule (by `sort_order`) whose condition holds sets its
`group_id` and picks a person by `method` — `fixed` (`user_id`), `round_robin` (the candidate assigned longest ago,
from the field history), `least_loaded` (fewest open records of the table, then the longest waiting), `skills`
(members whose profile skills include every `skills` entry, case-insensitive, then least loaded) or `oncall` (a
module's resolver, `setOnCallResolver`). Candidates are the group's valid members and leads who are active and not
out of office. A person with an active `assignments` delegation hands the record to their delegate.

### UI policies (`ui_policy`)

`condition`, `actions` (`[{ field, visible?, mandatory?, readonly? }]`), `applies_on` (`both` / `create` / `update`),
`message`, `tone`, `sort_order` (a later policy wins on the same field and property). The record UI applies them live
through `setPolicySource` (`GET /rules/ui-policies/:table` → `{ policies: UiPolicy[] }`, UI_RECORDS.md §9). The server
enforces **mandatory** and **read-only** on every write path:

- a mandatory field must not be empty on create, when the write empties it, or when the write changes a field the
  policy's condition reads (the moment the policy starts to apply) → 400 `«<label>» را وارد کنید` (prefixed with the
  policy's message); fields the caller can never fill (engine-maintained, read-only, hidden or not writable for them)
  are not asked for;
- a read-only field must not be changed by the caller's input → 400 `«<label>» در این وضعیت تغییر نمی‌کند`;
- imports are checked row by row; trusted server code and the system (rules, flows, jobs) are not held to policies.

### Sync pushes

Rules with side effects run once, on the runtime where the person acted: a Windows app runs them for its own writes
(the rule rows sync down like any configuration) and the cloud applies the pushed rows without running them again.
The cloud still validates each pushed row against the UI policies (`validatePush`); a refused row stays in the
Windows app's outbox with the Persian refusal as its error.

## 6. HTTP API

All under `/api/o/:org`. Configuration itself goes through the generic engine API (`/r/<table>`).

| method and path | body / query | answer |
| --- | --- | --- |
| `GET /calendars/holidays` | `from`, `to` (YYYY-MM-DD), `calendar?` | `{ holidays: [{ date, title, half?, predicted? }] }` |
| `GET /calendars/:id/spec` | `from`, `to` | `{ id, name, timezone, hours, holidays }` (read access to calendars) |
| `GET /calendars/bundled` | | `{ years: [1404, 1405, 1406], set: "ir" }` |
| `POST /calendars/seed` | `{ years?: number[] }` | `{ calendars, holidays, years }` (create access to holidays) |
| `GET /sla/records/:table/:id` | | `{ timers: [...] }` (§3) |
| `GET /approvals/mine` | `scope=pending|decided`, `limit?` | `{ approvals: ApprovalView[], display, delegators }` |
| `GET /approvals/mine/count` | | `{ count }` (the nav badge) |
| `GET /approvals/sources` | | `{ owners: string[] }` (owner sources registered by modules) |
| `POST /approvals/:id/decide` | `{ decision: "approved"|"rejected", comment? }` (a rejection needs a comment) | `{ approval, aggregate }`; 409 when not open or not yet its turn, 403 by separation of duties, 404 when not the caller's |
| `POST /approvals/decide` | `{ ids: uuid[] ≤ 200, decision, comment? }` | `{ done, failed: [{ id, message }] }` (each decided on its own) |
| `GET /approvals/record/:table/:id` | | `{ approvals: ApprovalView[], display, aggregate, can_request }` (the record must be readable) |
| `POST /approvals/record/:table/:id/request` | `{ users?, groups?, rule?, threshold?, comment?, expire_hours? }` | `{ approvals, aggregate, round }`; 409 while an ad-hoc request is open (write access to the record) |
| `POST /approvals/record/:table/:id/cancel` | | `{ canceled, aggregate }` — withdraws every open approval |
| `GET /rules/ui-policies/:table` | | `{ policies: UiPolicy[] }` (read access to the table) |

`ApprovalView` = the approval row + `table_label`, `rule_name` («درخواست موردی» for ad-hoc), `on_behalf_of` (the
approver the caller acts for), `can_decide`.

Example — approving two approvals with one call:

```http
POST /api/o/<org>/approvals/decide
{ "ids": ["<a1>", "<a2>"], "decision": "approved", "comment": "بودجه تأیید شد" }
→ { "done": 2, "failed": [] }
```

## 7. Screens

`src/ui/modules/sla` (registered in `modules/registry.tsx`):

- **«تأییدهای من»** (`approvals`, home space, with a live count): pending / decided, approve or reject one or many
  (a rejection asks for its reason), deadlines with «مهلت گذشته», «به جانشینی از …»; **«جانشینی‌ها»**
  (`approvals/delegations`, generic list and form).
- **Record pages**: an «تأییدها» side panel on tables with an `approval` field (steps with people and decisions, the
  caller's own approve / reject, «درخواست تأیید» and «پس گرفتن» for those who may change the record) and an
  «توافق‌ها» tab on records with timers (progress, deadline, what is left, the history on a timeline).
- **«توافق‌ها و قواعد»** (settings space): calendars (tab «ساعات کاری»: the week editor — intervals per day, presets,
  copy a day, 24-hour bars, overnight shifts, totals, the next two weeks with holidays), «تعطیلات» (a Jalali year by
  month, sets, half days, «پیش‌بینی» with «تأیید», official calendar seeding, edit in a drawer), SLA definitions (tab
  «اهداف و پیش‌نمایش»: targets per priority in hours and minutes, warning thresholds, and a timeline preview of
  warnings and the deadline on the definition's calendar), «زمان‌سنج‌ها» (read-only list), approval rules (tab «سطح‌های
  تأیید»: the levels builder with sources, rules, order and a sentence per level), business rules, assignment rules,
  priority matrices (tab «جدول اولویت»: the grid, «ITIL»), «دسته‌بندی‌ها» (the tree of a table with a side editor),
  UI policies. The raw JSON fields behind the special editors are hidden from the generic forms by module UI policies.

The sources: `setHolidaySource` and `setPolicySource` (§2, §5). Screens invalidate the record UI's
`records-holidays` / `records-policies` caches after edits.

## 8. Extension points for modules

```ts
import { registerPriorityDefault, registerApproverSource, setOnCallResolver } from "@server/modules/sla";

registerPriorityDefault("incident");                         // ITIL impact × urgency until the organisation defines a matrix
registerApproverSource("service_owner", async (q, ctx, def, row) => [ /* user ids */ ]);   // levels: { kind: "owner", of: "service_owner" }
setOnCallResolver(async (q, ctx, groupId, at) => userId ?? null);                        // assignment method "oncall"
```

- A table takes part in approvals by having an `approval` choice field (task tables do) — the field, the participant
  read access and the record panel follow. Any table can be the target of approval rules, SLAs and rules.
- SLA timers need nothing from the module: a definition names the table and its conditions. `sla_due` is maintained on
  tables that have it.
- Notifications and flows react to `record.sla_warning`, `record.sla_breach`, `record.approval_requested` and
  `record.approval_decided` with `onRecordEvent`.
- Flows (`src/server/modules/sla/flows.ts`, installed by `installSlaService()`): the flow step «درخواست تأیید» asks
  for an ad-hoc round with `requestApprovalIn` (inside the step's transaction; rule any / all / count) and is woken
  by the round's decision (`record.approval_decided`, the rows' `record.updated`) through `resumeFlowWait`; a canceled
  run withdraws its round (`cancelApprovals(ctx, table, id, { adhocRound })`). «انتظار زمانی» «به وقت کاری» counts
  working time with `slaBusinessClock` (`addBusiness` on the default calendar). docs/spec/services/flows.md §8.

## 9. Testing

| file | covers |
| --- | --- |
| `tests/sla-calendar.test.ts` | business-time arithmetic (Tehran, overnight shifts, holidays, half days, DST zones, algebra), timer maths |
| `tests/sla-engine.test.ts` | SLA lifecycle: attach, pause/resume, achieved/breached, warnings and breach once, priority repair, retroactive start, cancel/reset, calendars, timeline, seeding |
| `tests/sla-approvals.test.ts` | any/all/count/percent, sources, sequential/parallel, separation of duties, delegation, reminders and expiry, auto-approval, ad-hoc, bulk, read access while pending |
| `tests/sla-rules.test.ts` | priority matrix, category tree, business rules (order, tokens, abort, after-save actions, nesting limit), assignment methods, UI policies on the server (incl. imports) |
| `tests/sla-sync.test.ts` | side-effect rules run once across a Windows app and the cloud; pushes validated against UI policies |
| `tests/sla-ui.test.ts` | the screens' pure logic (`src/ui/modules/sla/model.ts`) |
