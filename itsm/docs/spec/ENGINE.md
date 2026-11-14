# The record engine

Everything an ITSM user works with — incidents, problems, changes, requests, CIs, assets, KB articles, and also
configuration such as SLA definitions, assignment rules or saved views — is a **record** of a **table** described
once as metadata (a `TableDef`). From that one description the engine generates the database table, validates and
stores values, enforces the state model, writes field history and events, secures every read and write through the
access provider, synchronises with the Windows app and serves one generic HTTP API. The UI renders lists, forms,
kanban boards and calendars from the same definitions.

This document is the contract for every module built on the engine. Code: `src/shared/model` (types, conditions,
task, Jalali windows, link kinds — imported by the UI too), `src/shared/tables` (the registry), `src/server/engine`
(the engine), `src/server/access/provider.ts` (security hook points), `src/server/jobs` (job queue),
`src/server/routes/records.ts` (HTTP API). Tests: `tests/engine-*.test.ts`.

Contents: [1 Defining a table](#1-defining-a-table) · [2 Field types and values](#2-field-types-and-values) ·
[3 Conditions](#3-conditions) · [4 States](#4-state-models) · [5 Record service](#5-record-service-server-api) ·
[6 Hooks](#6-hooks) · [7 Events](#7-events) · [8 Jobs](#8-jobs) · [9 Access provider](#9-access-provider) ·
[10 Journal, history, watchers, links, attachments](#10-journal-history-watchers-links-attachments) ·
[11 Tenant customisation](#11-tenant-customisation) · [12 HTTP API](#12-http-api) · [13 Synchronisation](#13-synchronisation) ·
[14 Storage and DDL](#14-storage-and-ddl) · [15 Testing](#15-testing) · [16 Rules of thumb](#16-rules-of-thumb)

---

## 1. Defining a table

A module describes its tables in `src/shared/tables/<module>.ts` and adds the array to `MODULE_TABLES` in
`src/shared/tables/index.ts` (tests and plugins may call `registerTable(def)` instead). Definitions are resolved once
at load time (`buildTable`): task fields merged, base fields added, `$self`/`$table` placeholders replaced, and the
whole definition checked — a mistake throws at startup, never at request time.

```ts
// src/shared/tables/incident.ts
import type { TableDef } from "../model/types";

export const INCIDENT: TableDef = {
  key: "incident",                 // API paths, refs, events: /r/incident, ref: "incident", e.table === "incident"
  table: "sm_incidents",           // physical table, always sm_*
  label: "رخداد", plural: "رخدادها", icon: "siren",
  module: "incident", area: "work",
  extends: "task",                 // TASK_FIELDS + task behaviours + default task states and scope
  numbered: { prefix: "INC", pad: 7 },           // INC0000001
  display: "short_description",    // what a reference to a record shows
  fields: [
    { name: "major", label: "رخداد عمده", type: "bool", filter: true },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category" }, // overrides the task field
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true },
  ],
  scope: {},                       // empty = the task scope (own: caller/requested_for/opened_by/assigned_to…)
  features: { sla: true, approvals: false, kanban: "state" },
  list: { columns: ["number", "short_description", "state", "priority", "assigned_to"], order: "-updated_at" },
  form: { sections: ["اصلی", "حل"], related: [{ table: "incident_task", field: "parent_id" }] },
};
```

### TableDef

| key | meaning |
| --- | --- |
| `key` | `[a-z][a-z0-9_]*`, unique. Used in URLs, refs, events, sync entities. Never renamed. |
| `table` | `sm_*` physical table. |
| `label`, `plural`, `icon`, `description` | Persian labels; `icon` is a lucide icon name. |
| `module`, `area` | owning module; access area the default provider checks (`@shared/permissions` `AREAS`). |
| `extends: "task"` | adds `TASK_FIELDS` (own fields with the same name replace/extend them), the default task state model unless `states` is given, the task scope unless `scope` is non-empty, features `journal`, `attachments`, `watchers`, `links`. |
| `numbered: { prefix, pad }` | per-organisation counter, `prefix` `[A-Z][A-Z0-9_-]{0,11}`, `pad` 1–12. Adds the base field `number`. |
| `display` | the display field (must exist). |
| `fields` | `FieldDef[]` (§2). Names `[a-z][a-z0-9_]*`, not a base column, not an SQL reserved word, not starting with `u_` (tenant custom fields). |
| `states` | state model (§4). Its field becomes a `choice` with the states as options and the initial state as default. |
| `scope` | which columns mean "mine / my group / my unit…" for the access model: `own` (user fields), `watchers` (users field), `group` (assignment group field), `unit`, `domain`, `workspace` (default `unit_id`, `domain_id`, `workspace_id`). |
| `features` | `journal`, `attachments`, `watchers`, `links`, `history` (default true), `sync` (default true), `sla`, `approvals`, `rag`, `tags`, `survey`, `confidential`, `kanban` (group-by field), `calendar: { start, end? }`. `watchers` adds a `watch_list` users field if missing. |
| `form`, `list` | UI layout: sections, tabs, related lists; default list columns and order (`"-priority,number"`). |
| `unique` | combinations of fields unique per organisation among live rows (`[["table_key","name"]]`). |
| `rowAccess` | `{ read?: Cond, write?: Cond }` row rules every caller is held to on top of the provider (personal saved views). `NEVER` (`@shared/model/conditions`, an empty `or`) is the constant-false rule: a runtime-only table (`ai_agent_run`) is read by no member through the generic API, only by its module's routes; `write: NEVER` marks a table only the platform writes (computed scores and facts, deliveries, logs, the ledgers a module books, the runtime's own records: `slm_xla_score`, `service_score_fact`, `analytics_score`, `allocation_result`, `ai_skill_run`, `va_message`…) — `/meta/tables` offers nobody «… تازه» or import (`can.create` false whatever the roles), a person's create is refused (403) before its values are read, the generated AI tools draft none, and no flow creates or changes its rows whoever it runs as (refused when published and when the step runs). A ledger a Windows app pushes as the trace of its own changes (ITAM custody, device status and assignments, SLA timers, survey answers) is not marked: its module's push rules judge those rows and its `beforeWrite` refuses people online (`tests/system-tables.test.ts`). |
| `levels` | levels of `area` the default provider asks for: `{ read: "view", create: "edit", write: "edit", delete: "full" }` by default. |
| `ai` | `{ title, text[] }` fields that make up the RAG document. |
| `virtual` | a reference target without a physical table (only the built-in `user`). |

Base fields added to every table (system, filterable/sortable where it makes sense): `number` (numbered tables),
`created_at`, `created_by`, `updated_at`, `updated_by`, `workspace_id` (writable), `domain_id`, `unit_id`.
Base columns not exposed as fields: `id`, `org_id`, `no`, `rev` (sync revision), `version` (concurrency token),
`deleted_at`, `origin`, `custom` (tenant custom field values).

Registry API (`@shared/tables`): `TABLES` (Map key → resolved def), `tableDef(key)`, `fieldOf(def, name)`,
`physicalTables()`, `registerTable(def)`, `onTableRegistered(fn)`, `registerChoiceList(key, options)`,
`CHOICE_LISTS`, `USER_DEF`.

### Placeholders

- `ref: "$self"` → the table itself (`parent_id`).
- `choices: "$table.category"` → the list `<key>.category` (`incident.category`). Default options come from
  `registerChoiceList` (or `CHOICE_LISTS`); organisations edit them (§11).

### The task (`src/shared/model/task.ts`)

`TASK_FIELDS`: short_description (required, 200), description (markdown), state, priority (1–5, default 4), impact,
urgency, category, subcategory (depends on category), channel, caller_id (default `$me`), requested_for, opened_by,
opened_at, assignment_group_id (group), assigned_to, service_id, offering_id, ci_id, location_id, due_at,
resolved_at/by, closed_at/by, close_code, close_notes, parent_id (`$self`), watch_list, approval (readonly),
escalation, reassignment_count, reopen_count, time_worked (duration), first_response_at, active, sla_due, knowledge.

Default states (`DEFAULT_TASK_STATES`): new → in_progress / on_hold / resolved (requires close_code, close_notes) /
canceled (requires close_notes); on_hold → in_progress / resolved / canceled; resolved → in_progress (reopen) /
closed. Locked: closed, canceled.

Task behaviours (any table that has the fields): `opened_at/opened_by` stamped on create; `active` follows the state
category; resolved/closed stamps and reopen counting (§4); `reassignment_count` + 1 when `assigned_to` or the scope's
group field changes from a non-empty value; `first_response_at` stamped by the first public comment of someone who is
not `caller_id`/`requested_for`.

The core tables (`src/shared/tables/core.ts`): `custom_field`, `choice` (tenant customisation, area `settings`),
`view` (saved list views, personal unless `shared`), `todo` («کار», a generic task — the engine's demo table) and the
virtual `user` (members: `name`, `email`, `title`, `role`, `is_active`).

## 2. Field types and values

| type | SQL | stored / returned | accepted input |
| --- | --- | --- | --- |
| `string` | text | trimmed one-line string (≤ 500 or `maxLength`) | any scalar |
| `text` / `markdown` | text | multi-line string (≤ 20 000 / 200 000) | |
| `email` | text | lower-case address | validated |
| `url` | text | `http(s)://…` only | |
| `phone` | text | digits normalised | `+`, digits, spaces, `()-#*` |
| `ip` | text | IPv4/IPv6, optional `/bits` | |
| `int`, `rating` | integer | number (rating 0–5 unless min/max) | Persian/Arabic digits, `٬`/`,` grouping |
| `duration` | bigint | seconds | seconds or `H:MM[:SS]` |
| `decimal`, `money`, `percent` | numeric | exact decimal **string** (`"1.5"`) | `۱٫۵`, `1,250.75` |
| `bool` | boolean not null | `true`/`false` | `true/false/1/0/بله/خیر/yes/no` |
| `date` | date | `"YYYY-MM-DD"` | ISO, Jalali `1405/01/15` or `14050115`, an ISO instant (its local date) |
| `datetime` | timestamptz | ISO instant `"…Z"` | epoch ms, ISO with zone, wall clock in the org's zone (`2026-03-21T10:30`, `1405/01/01 10:30`) |
| `choice` | text | option value | must be an active option (an inactive one stays valid on rows that carry it) |
| `multichoice`, `tags` | jsonb | `string[]` (`[]` when empty) | array or `"a، b"`; tags ≤ 50 × 60 chars |
| `ref`, `user`, `group` | uuid | lower-case id | id or `{ id }` |
| `refs`, `users` | jsonb | `string[]` of ids | |
| `json`, `conditions` | jsonb | JSON | value or JSON text; conditions are validated against `condTable` / the table named by `condTableField` |
| `color` | text | a `COLOR_KEYS` name (never hex) | |
| `secret` | text | **never returned**: `{ secret: true, hint: "…abcd" }` (`hint: false` on the field: always «…», for structured text) | plain string; send the `{ secret: true }` object back to keep it |

FieldDef options: `required`, `noSync` (kept out of Windows-app replicas, §13), `readonly` (shown in its place on the form; ignored in input — hooks and trusted
server code set it), `hidden` (UI only), `system` (bookkeeping of the engine or a module: ignored in input, set by hooks
and trusted server code only — never by business rules, flows, question mappings or imports; on forms it sits in
«اطلاعات سامانه» and never on a new record), `default` (value or `$now`, `$today`, `$me`, `$my_unit`, `$my_domain`),
`choices` (options or list key), `dependsOn` (an option's `parent` must equal the parent field's value), `ref`,
`refFilter` (condition the referenced record must satisfy, enforced on write), `condTable` / `condTableField`,
`min`/`max`, `maxLength`, `unique`, `list`/`search`/`filter`/`sort`/`index`, `group` (field security group),
`audit` (default true), layout (`span`, `section`, `tab`, `help`, `placeholder`, `ltr`), `ai`.

Validation (`src/server/engine/values.ts`): every caller (API, import, hooks, sync push) goes through
`coerceValue(field, raw, vc, prev)`; whole rows through `validateRow` (required — all on create, changed ones on
update —, dependent choices, conditions) and `checkRefs` (refs point at live rows of the same organisation /
members, and satisfy `refFilter`; one query per target; targets without a table yet are checked as ids only).
Errors are collected per field:

```json
{ "error": { "code": "validation", "message": "«عنوان» را وارد کنید",
             "details": { "fields": { "short_description": "«عنوان» را وارد کنید", "priority": "«9» از گزینه‌های «اولویت» نیست" } } } }
```

Secrets are sealed with the runtime's secret (AES-256-GCM, bound to org/table/field/record). Server code reads one
with `openSecret(cfg.secret, orgId, table, field, recordId, stored)`; secrets never travel through sync.

## 3. Conditions

One JSON language for filters, saved views, queues, rules, SLA conditions, notifications, UI policies, row rules,
scopes and reports (`src/shared/model/conditions.ts`):

```ts
type Cond = { and: Cond[] } | { or: Cond[] } | { not: Cond } | { f: string; op: Op; v?: unknown };
// { and: [ { f: "state", op: "in", v: ["new", "in_progress"] },
//          { f: "assigned_to", op: "is_me" },
//          { f: "caller_id.title", op: "contains", v: "مدیر" },
//          { f: "opened_at", op: "relative", v: { unit: "week", n: 1 } } ] }
```

| op | value | applies to |
| --- | --- | --- |
| `eq`, `ne` | one | everything comparable; on arrays: holds / does not hold the value |
| `in`, `nin` | list (≤ 500) | scalars; on arrays: holds any / none |
| `lt`, `lte`, `gt`, `gte`, `between` | one / `[from, to]` (inclusive) | numbers, dates, date-times |
| `contains`, `ncontains`, `starts`, `ends` | one | text (normalised, see below); `contains` on arrays = holds |
| `empty`, `nempty` | — | everything (`""`, `null`, `[]`, `{}` are empty) |
| `is_me` | — | user, users |
| `is_my_group` | — | group fields, refs to `group` |
| `in_my_groups` | — | groups: one of my groups; users: a member of one of my groups |
| `in_my_unit`, `in_my_unit_tree` | — | users (members of my unit / subtree), refs to `org_unit`, `unit_id` |
| `in_my_unit_line` | — | a ref or refs to `org_unit` holds my unit or one above it (`env.unitLine`): something shared with a unit reaches its sub-units (document collections «واحدها با زیرمجموعه‌ها»); SQL and JS alike |
| `is_my_location` | — | a ref or refs to `location` holds my location or one above it (`env.locations`: the member profile's location and its ancestors — a building's or a site's record reaches the people on its floors); SQL and JS alike |
| `relative` | `{unit, n, dir}` or `{unit, from, to}` | dates and date-times |
| `changed`, `changes_to`, `changes_from` | — / one | rules only (`validateCond(c, def, { rules: true })`), compare with `env.prev` |

Semantics (identical in `evaluate` and SQL — `tests/engine-conditions.test.ts` checks every operator on both):

- A leaf is never NULL: positive operators are false on an empty value, `ne`/`nin`/`ncontains` true — so `not`
  composes the same way in JS and SQL.
- Text matching is case-insensitive for Latin letters and ignores Persian typing differences: Persian/Arabic digits,
  ي/ی، ك/ک, zero-width marks (`normalizeSearch`; SQL `translate(…)`). `eq`/`in` compare text exactly.
- Date-times compare to the millisecond; a bare date as an operand of a date-time means its local midnight.
- `relative`: `{unit: "day"|"week"|"month"|"quarter"|"year", n, dir: "past"|"next"}` = the last/next n units
  *including* the current one (`n: 0` = only the current unit); `{unit, from, to}` = offsets from the current unit
  (`{unit: "month", from: -1, to: -1}` = last month). Weeks start on Saturday, months/quarters/years are Jalali, all in
  the organisation's time zone (`env.tz`). Boundaries come from `src/shared/model/jalali-buckets.ts`.
- `f` may walk one or two single references: `caller_id.email`, `parent_id.assigned_to.name`. Walks into a record
  the caller may not read yield nothing (SQL adds the access predicate of the target table).

API: `evaluate(cond, row, env, def?, lookup?)`, `validateCond(cond, def, { rules?, lookup?, visible? })` (Persian
reason or null), `describe(cond, def, opts)` («وضعیت یکی از «جدید»، «در حال انجام» است و کارشناس من هستم»),
`opsFor(type, target)`, `condPaths(cond)`, `resolvePath(def, path)`, `relativeWindow(v)`, `OPS` (labels).
Server: `toSql(cond, def, alias, params, env, { ctx?, lookup? })` → parameterised predicate (`$n`),
`searchSql`, `orderSql`, `readable(ctx, def, alias, params, env)`.

`CondEnv`: `now`, `tz`, `userId`, `groups`, `groupUsers`, `unitId`, `unitTree`, `unitUsers`, `unitTreeUsers`, `prev`.
The engine gets it from the access provider once per request: `condEnv(ctx)`.

## 4. State models

```ts
states: {
  field: "state", initial: "new",
  states: [{ value: "new", label: "جدید", category: "new", color: "blue" }, …],
  transitions: [
    { from: ["new", "on_hold"], to: "in_progress", label: "شروع کار" },
    { from: ["new", "in_progress"], to: "resolved", label: "حل شد", requires: ["close_code", "close_notes"],
      roles: { area: "work", level: "edit" }, guard: "has_no_open_tasks" },
    { from: "*", to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],   // default
}
```

Categories: `new`, `active`, `waiting` (open), `resolved`, `closed`, `canceled` (done). Side effects and reporting
hang on categories, never on state values:

- entering `resolved` → `resolved_at = now`, `resolved_by = actor`;
- entering `closed`/`canceled` → `closed_at/closed_by`; closing also stamps `resolved_at/by` when empty;
- `active` = category is open;
- from a done category back to an open one (reopen) → `reopen_count + 1`, resolved/closed stamps cleared.

The engine enforces transitions: `transition(ctx, table, id, to, data)` or an update whose data changes the state
(treated as the matching transition). It checks: the transition exists from the current state (409 `transition`),
the provider's `canTransition` (`roles`), `requires` fields non-empty after applying `data` (400 `validation`), the
named `guard` and every `validateTransition` hook (409 with their message). Records in a locked category refuse
updates (409 `locked`) except transitions out of them, watchers and engine stamps. A record may be created in any
state (imports); the category effects apply. `meta.transitions` lists what the caller may take now.

## 5. Record service (server API)

`import { list, get, create, update, transition, remove, bulkUpdate, aggregate, … } from "@server/engine"`.
Every function takes the request's `ctx`; reads go through the access provider, writes through the write pipeline
inside `ctx.write`. Server code that already holds a transaction uses the `*In` variants.

```ts
list(ctx, "incident", { filter, q, sort: "-priority,number", page: 1, size: 50, fields: ["number", "caller_id.email"], ids, view, total })
  → { rows, total, page, size, display }
get(ctx, "incident", id)                       → { row, display, meta }
create(ctx, "incident", data, opts?)           → { row, display, meta }
update(ctx, "incident", id, data, { version }) → { row, display, meta }   // 409 version_conflict when stale
transition(ctx, "incident", id, "resolved", { close_code: "solved", close_notes: "…" }, { version })
remove(ctx, "incident", id, { version })       → { ok: true }             // soft delete
bulkUpdate(ctx, "incident", { ids | filter, data?, transition?, delete? }) → { updated, failed: [{ id, message }] }
aggregate(ctx, "incident", { filter, q, groupBy: ["priority", { field: "opened_at", bucket: "month" }],
                             metrics: [{ fn: "count" }, { fn: "avg", field: "time_worked" }], limit })
  → { groups, rows: [{ keys, labels, values }], totals, display }

// inside a transaction (hooks, flows, jobs, modules):
await ctx.write(async (tx) => {
  const row = await createIn(tx, ctx, "incident_task", { parent_id: id, short_description: "…" });
  await updateIn(tx, ctx, "incident", id, { assigned_to: user }, { trusted: true });
  await transitionIn(tx, ctx, "incident", id, "in_progress");
  await removeIn(tx, ctx, "incident_task", row.id);
});
```

- **Rows**: `id`, `version`, `number` (numbered tables) and the visible fields; custom fields as top-level `u_*`
  keys; arrays never null; secrets as `{ secret: true, hint }`. Lists return every visible field except long ones
  (text, markdown, json, conditions) unless `fields` names them; the state field always comes along.
- **display**: `{ [id]: label }` for every referenced record and member in the response — members by name, records
  by their display field, numbered ones as `INC0000012 — عنوان`, deleted ones with « (حذف‌شده)». Ids the caller may
  not read are absent (show them as restricted). One query per referenced table.
- **meta** (single records): `canWrite`, `canDelete`, `readonly` (field names the caller cannot change),
  `transitions` (`{ to, label, requires, category }`), `locked`, `watching` (tables with watchers), plus keys added
  by `registerRecordMeta` (e.g. `sla`, `viewers`).
- **Concurrency**: `version` is the concurrency token (moved by every user write; `rev` is the sync revision — do not
  use it). Without `version`, the last writer wins. A write that changes nothing does not move it.
- **Input rules**: unknown keys → 400; base columns are ignored, and so are `system` and `readonly` fields unless the
  write is `trusted` (server code: a module stamping its own fields from a service or a job); a field outside the
  provider's `writableFields` → 403 `forbidden_field` *only if its value would change* (a whole row can be sent back).
- **WriteOptions**: `version`, `via` (`"api" | "import" | "sync"`, recorded on events), `trusted` (server code: may
  set system and readonly fields, field permissions not asked), `keepVersion` (engine stamps that must not invalidate open
  forms), `allowLocked`, `skipAccess` (the caller checked access itself).
- **Lists**: `filter` (validated; fields the caller may not see refused), `q` (every word must appear in a
  `search` field, Persian-normalised; or the record number `۱۲` / an id; a full number with its prefix such as
  `INC0000012` or `inc-12` is looked up by number alone), `sort` (up to 4 fields; static
  choices in option order, users/refs by display text, numbers by counter, empty last; text/markdown/json/arrays are
  not sortable), `view` (a saved view's filter, q, sort, columns, page size are the defaults; your `filter` is ANDed
  to it), `ids`, `total: false` to skip counting, `countLimit` (the HTTP API passes 10 000: past it `total` is that
  limit and `capped: true` — «بیش از ۱۰٬۰۰۰»), `after` (the previous page's `next` cursor: keyset pagination for sorts
  on `updated_at`, `created_at` or `number` in one direction — an index range scan at any depth), `archived` (read the
  table's archive of old closed records, §14).
- **Aggregates** run in SQL: group by up to 3 fields or paths — choices, refs, users, groups, booleans, numbers, short
  texts; array fields count each element (`(خالی)` for none); dates/date-times by `bucket` day / week (from Saturday)
  / month / quarter / year on the Jalali calendar in the org's time zone. Bucket keys: `2026-03-21` (day, week),
  `1405-01`, `1405-Q1`, `1405`; labels «فروردین ۱۴۰۵»، «بهار ۱۴۰۵». Metrics `count` (with a field: non-empty count),
  `sum`, `avg` (6 decimals), `min`, `max` (also dates), `median`, `p90` on numbers; keys `count`, `sum:estimate`…
  Numeric results are decimal strings. `totals` are computed over records (an array grouping never counts a record
  twice there). Groups are ordered by bucket, otherwise by the first metric descending.
- **Writes run side by side** (`ctx.write`, PERFORMANCE_FA.md «دور سوم»): no organisation-wide lock. Sync revisions are
  the writing transaction's id (§13), so they need no order. What keeps a write correct under concurrency:
  - a record's own writes queue on its row: update, transition and delete lock it (`for update` in `startFrom`) and
    re-read it, the `version` token refuses a stale client copy; numbers come from the row-locked counter (`sm_numbers`);
  - **values derived from several rows** (an order's totals from its items, a group's roll-up, counts of open cases)
    are recomputed in before-commit work (`onBeforeCommit(tx, key, fn)`): each key is locked for the rest of the
    transaction (an advisory lock on its hash) before its work runs, so two transactions recomputing the same value take
    turns and the second one reads what the first one committed. Module code that decides one record's write from
    other rows does it there, or locks the row it decides (`loadReadable(…, { lock: true })` as approvals do,
    `lockedRow(q, ctx, table, id, "update" | "share")` in modules: a parent's state, a list stored on a row);
  - **create-if-absent and choices from other records** (one open issue per control, the next assignee of a group, a
    link and its reverse) take a transaction lock on a narrow key first (`lockKey(tx, key)` — a key naming the
    organisation or a record, never a bare kind), or rely on a unique index with `on conflict` — only for rows a
    Windows app cannot hold a local duplicate of (a pull stops on a unique clash `sync/apply.ts` cannot resolve; it
    resolves record numbers and codes). Work that may create thousands of such rows in one transaction (an import, a
    rule's first run) locks the rows the duplicates hang off (`for update`, in id order: a CMDB relationship locks its
    two CIs) or takes one key for the whole run (`cmdb.ire:<org>`), never a key per row (each held key is an entry of
    the shared lock table until commit);
  - a deadlock or a serialization failure (`40P01`/`40001`) rolls one transaction back: the engine's single-record
    `create`/`update`/`transition`/`remove` run again (`ctx.write(fn, { retry: true })` — only for work whose every
    effect is inside the transaction), a job's handler runs again from its stored payload before the attempt counts,
    a sync push and every other request answer 503 «سیستم مشغول است؛ دوباره امتحان کنید» (never a 500).
  `ITSM_SERIALIZE_WRITES=1` (the server edition: kariz.json `serialize_writes`, the variable wins) brings back the
  organisation lock on every write (from its start; `late`/`internal` ones at their first synced statement —
  `ensureOrgLock`) as an operational fallback; sync does not depend on it. `lockOrg`
  stays for rare organisation-wide changes (creating or adopting an organisation, restores). Per process at most
  `ITSM_WRITERS_PER_ORG` (3; the server edition reads `writers_per_org` from kariz.json, the variable wins) write
  transactions of an organisation are in the database at once (`admitWrite`): a throttle that keeps a burst (an
  import, a notification storm) from taking every pool connection of the process. Keep model calls, rendering and
  network out of write transactions; the probe (`src/server/db/lockprobe.ts`, `scripts/serve-pg.mjs --lock-stats`)
  measures what still takes the organisation lock.
- **Set-based system rows**: `insertManyIn(tx, systemCtx, table, rows)` creates many rows with ONE insert — the
  platform's own output (a notification's bell rows for every recipient). Each row is coerced, defaulted, passed to the
  beforeWrite hooks (access anchors…) and validated like a create, the stored rows go to the afterWrite hooks, the
  trigger gives every row its sync revision; no statement per row, **no record events**, no reference checks. Refused
  for numbered tables, tables with a state model or with field history, and outside the system context.
- Also: `recordMeta`, `checkFilter`, `exportRows`, `importRows` (§12), `tablesMeta`/`tableMeta`, `systemCtx(cfg,
  orgId, { onBehalfOf })` (a context in which the platform itself acts — allowed everything in its organisation by
  the provider, writes still hold the write lock), `condEnv(ctx)`, `orgSchema(ctx)` (effective defs with tenant
  customisation), `loadReadable`/`requireReadable`, `toOutput`, `RefSet` + `resolveDisplay` (display values for
  your own queries), `allocateNumber`, `openSecret`, `readSecret(q, ctx, def, id, field)` (the plain value of a secret
  field for trusted server code that checked the caller's access itself — records only ever carry the hint; null
  when empty or sealed by another runtime's key; never query the column yourself).

## 6. Hooks

```ts
import { registerHooks } from "@server/engine";
registerHooks("incident", {
  beforeWrite(w) {               // may change w.next; throw an AppError (Persian) to refuse
    if (w.op === "create" && w.next.major && !w.next.assignment_group_id) throw bad("رخداد عمده گروه پشتیبانی لازم دارد");
  },
  async afterWrite(w) {          // same transaction: keep derived data in step with w.tx; enqueue jobs for slow work
    if (w.changed.has("priority")) await enqueue(w.tx, { kind: "incident.recalc", orgId: w.ctx.org.id, payload: { id: w.row.id } });
  },
  validateTransition(w) {        // Persian refusal or null
    return w.transition.to === "resolved" && w.next.major && !w.next.problem_id ? "برای رخداد عمده، مشکل را مشخص کنید" : null;
  },
  guards: { has_no_open_tasks: async (w) => ((await openTasks(w.tx, w.next.id)) ? "کارهای باز باقی است" : null) },
});
registerRecordMeta("incident", async ({ q, ctx, row }) => ({ sla: await slaTimers(q, ctx, row) }));
```

`WriteArgs`: `tx`, `ctx`, `def`, `op` (`create | update | transition | delete`), `next` (row as it will be stored;
custom fields as `u_*`), `prev` (null on create), `changed` (Set of field names), `transition?`, `env`. Hooks of the
table run before those registered for `"*"`, in registration order. Values a `beforeWrite` sets are coerced like
input (no permission checks); history, events and `afterWrite` see them. Never call a model or an external service
in a hook — enqueue a job. Each `register*` returns an unregister function.

`redactRows(q, ctx, def, rows)` is the one read hook: a table whose rows keep copies of other records' data (a CI
baseline's snapshot, an import run's row results) removes, in place, what the reader may not read of those records.
It runs on `get`, `list` (and so exports) and sync pulls, never for the system; list rows hold only their selected
fields. A sync push that sends a redacted value back unchanged keeps the stored value (so a Windows app never
overwrites a full copy with its reader's view).

**Once per transaction** — `onBeforeCommit(tx, key, fn)` (from `@server/engine`, implemented by both database
layers): `fn` runs once, just before `tx` commits, however many writes queued it under the same `key` while it was
waiting — a roll-up of many child writes (`request.rollup:<id>`: an order's totals, people and state from its items)
or a recount. It runs in the same transaction (its writes commit with it, a failure rolls everything back), in the
order the keys were first queued; work it queues runs after it (twenty rounds at most), and a key that already ran
may run again. Work queued inside a savepoint that rolled back still runs: let it recompute from what is stored.
Readers inside the same transaction see the result only after the commit point, so keep it to derived data.

## 7. Events

Every create/update/transition/delete writes events into the job queue **in the same transaction** (outbox):

| kind | payload (besides `org_id`, `table`, `id`, `number`, `actor`, `at`, `via`) |
| --- | --- |
| `record.created` | — |
| `record.updated` | `changed: string[]`, `changes: { field: { from, to } }` (short values only, never secrets) |
| `record.state_changed` | `from`, `to`, `from_category`, `to_category` |
| `record.assigned` | `assigned_to: { from, to }`, `assignment_group: { from, to }` (on create too when set) |
| `record.deleted` | — |
| `record.commented` | `entry: { id, kind, visibility }` |
| `record.linked` / `record.unlinked` | on both records of a link: `data: { link_id, kind, direction: "out" \| "in", other_table, other_id }` (also for links a Windows app pushed, `via: "sync"`) |
| `record.flow_ended` | a flow run started on the record ended: `data: { run_id, flow_id, flow_name, state: completed \| failed \| canceled, error, outputs, test }` (flows, §8 of services/flows.md) |
| `record.attachment_added` / `record.attachment_removed` | a file was attached to / removed from the record: `data: { attachment_id, name, mime }` (the AI index re-reads tables with `ai.attachments`) |

One update may emit several (updated + state_changed + assigned). Subscribe without touching the engine:

```ts
onRecordEvent("notifications", async (e, jctx) => { … }, { tables: ["incident"], kinds: ["record.assigned"] });
```

Delivery is at-least-once: the job of an event runs the matching subscribers in registration order; one that throws
makes the job retry with backoff, and subscribers that already succeeded are skipped on the retry (by `name`).
Subscribers run outside any transaction on the runtime that applied the write — a Windows app for its own writes, and
the cloud again when it applies the pushed rows (`via: "sync"`): code that talks to the outside world should check
`jctx.cfg.mode` if it must act once. `emitEvent(tx, ctx, event)` lets modules emit their own kinds (e.g.
`record.sla_breached`).

## 8. Jobs

`src/server/jobs` — `sm_jobs` (kind, payload, run_at, status queued/running/done/failed, attempts, max_attempts,
locked_until, dedupe_key, last_error).

```ts
await enqueue(tx, { kind: "sla.check", orgId, payload: { id }, runAt, delayMs, dedupeKey: `sla:${id}`, maxAttempts: 8 });
registerJobHandler("sla.check", async (job, jctx) => { … return { again: 60_000 }; });   // "sla.*" handles a family
await tick(cfg, { budgetMs: 4000, max });   // → { ran, failed, more, busy? }
```

- Enqueue inside the write transaction when the job follows a write (it exists exactly when the write committed).
  `dedupeKey`: no second job with that key per organisation while one is queued (the queued one's id is returned).
  `enqueueMany(q, jobs)` adds many with one statement (same dedupe rule); `jctx.saveIn(tx, payload)` saves a job's
  progress inside the transaction that does the work, so a retry after a crash skips what committed.
- `tick` claims due jobs one at a time (`for update skip locked`; a running job's lock lasts 5 minutes and an expired
  lock is taken over), runs handlers outside transactions until the budget is spent. A throw → retry after 15 s, 30 s,
  1 min … ≤ 1 h (+20 % jitter) until `max_attempts`, then `failed` with `last_error`; `PermanentJobError` fails at
  once; `{ again: ms }` reschedules without counting an attempt; `jctx.save(payload)` keeps progress; `jctx.deadline`
  is when the budget ends. Finished jobs are kept 3 days (failed 30).
- Triggers: the Windows app ticks every 10 s; the web version ticks after every write request that queued jobs
  (`cfg.waitUntil`, Next.js `after`, budget 4 s) and on `GET|POST /api/cron/tick` (Bearer `CRON_SECRET` when set;
  call it every minute from Supabase pg_cron + pg_net or a GitHub Actions schedule; `vercel.json` has a daily
  fallback).

## 9. Access provider

`src/server/access/provider.ts` is the ONE place the engine asks who may read, create, change or delete which rows and
fields. Every read path (list, get, aggregate, dot-walks, display values of refs, journal, history, attachments, links,
export, import look-ups, meta, sync pull) builds its SQL with `readWhere`; every write path asks `canCreate` /
`canWrite` / `canDelete` / `writableFields` / `canTransition`.

```ts
interface AccessProvider {
  name: string;
  readWhere(ctx, def, alias, params): string;          // SQL predicate on alias (push params, $n numbering)
  canReadTable(ctx, def): boolean;
  canCreate(ctx, def, row?): boolean;
  canWrite(ctx, def, row): boolean;
  writeMode?(ctx, def, row): "full" | "requester" | null; // optional: how (absent = canWrite means full)
  canDelete(ctx, def, row): boolean;
  visibleFields(ctx, def): ReadonlySet<string> | null;  // null = all
  writableFields(ctx, def, row | null): ReadonlySet<string> | null;
  hasFieldGroup(ctx, group): boolean;                   // journal "internal" needs "internal"
  canTransition(ctx, def, row, transition): boolean;
  env(ctx): Promise<CondEnv>;                           // groups, unit, tz… (cached per request by the engine)
}
setAccessProvider(p) → restore();  access() → current
```

Contract: `readWhere` MUST include tenant isolation (`alias.org_id = $org`) and MUST NOT filter deleted rows (the
engine adds `deleted_at is null` where it wants live rows; the sync pull needs deleted ones). For the virtual `user`
table the alias is an `sm_org_members` row. `ctx.actor === "system"` is allowed everything in its organisation.
`TableDef.rowAccess` is applied by the engine on top. The default provider: tenant isolation + the platform's area
levels (`def.area`, `def.levels`), all fields visible, internal journal entries for everyone but viewers,
transitions with `roles` need that area level. The ITSM access model (org tree, data scopes, field security, domain
separation) replaces it with `setAccessProvider` and calls `bumpScopeEpoch(tx, orgId, userId)` whenever what a
member may read changes (groups, units, roles).

The ITSM model (`docs/spec/ACCESS.md`) is installed for every server. Its provider implements the optional
`prepare(ctx, q)`, which `orgSchema` awaits first on every entry point (with the request's transaction when there
is one), so the synchronous methods find the caller's subject loaded. Its hook sets the access anchors `unit_id` and
`domain_id` (system base columns the engine now persists when a hook sets them, never from input), and the generated
DDL indexes the anchor columns and the own user fields of every table with own fields or a group field.

## 10. Journal, history, watchers, links, attachments

- **Journal** (`sm_journal`, features.journal): kinds `comment` (always public), `work_note` (always internal),
  `system`, `email_in`, `email_out`, `approval`, `ai` (server code only: `addJournalIn(tx, ctx, def, row, input,
  { trusted: true })`). Internal entries are read and written only with the `internal` field group. Whoever may read
  a record may comment on it. Body: markdown ≤ 100 000. `attachments`: ids of attachments of the same record.
  Emits `record.commented`.
- **History** (`sm_history`): one row per changed audited field (`audit !== false`, not base) with old/new JSON,
  actor and time — written for creates (the caller's initial non-empty values), updates and transitions; secrets
  without values; texts cut at 10 000. Read with `listHistory` (fields the caller may not see are left out).
- **Watchers**: the users field `watch_list` (`scope.watchers`). Whoever may read may watch; adding others needs
  write access. A watcher change writes history and `record.updated` but does not move `version`; closed records
  accept it.
- **Links** (`sm_links`): typed (`LINK_KINDS`: related, caused_by, duplicate_of, fixes, implements, affects,
  blocks; modules add kinds with `registerLinkKind(key, { out, in })`), stored once from → to and listed on both
  records with the label of their direction («ناشی از» / «علت»). Adding needs write access to the record it is added
  from (features.links) and read access to the other; symmetric kinds are unique in both directions; lists leave out
  links whose other record the caller may not read. `addLinkIn(tx, ctx, table, id, input)` / `removeLinkIn(tx, ctx,
  table, id, linkId)` do the same inside a module's write (the change made from an incident and its «آغازشده از»
  link commit together); both emit `record.linked` / `record.unlinked` on both records, so a counter follows at once
  (the change module's «رخدادهای ناشی از این تغییر»).
- **Attachments** (`sm_attachments` + `sm_blobs` deduplicated per organisation by sha256): whoever may read a record
  may attach; removing needs write access or being the uploader. Limit: org setting `attachment_max_mb` (default 10;
  the web platform caps request bodies at ~4.5 MB). Names are made safe (no paths, control/bidi characters, reserved
  Windows names, ≤ 180 chars); types are sniffed from the bytes; only PNG/JPEG/GIF/WebP are ever served inline
  (`?inline=1`), everything else as `attachment` with `nosniff` and a sandboxing CSP, `Content-Disposition` with an
  ASCII fallback and the RFC 5987 UTF-8 name.

## 11. Tenant customisation

Both are ordinary engine tables (lists, forms, history, sync for free; area `settings`):

- `custom_field` rows `{ table_key, name, label, type, choices | options, ref, required, list, search, filter, help,
  section, max_length, sort_order, active }`. A name `u_*` adds a field stored in the row's `custom` jsonb —
  validated, filterable, sortable, searchable, audited and synced like a built-in one (types: every type except
  `secret`, `json`, `conditions`). The name of an existing field overrides its `label`, `help`, `list` and can make an
  optional field `required`.
- `choice` rows `{ list, value, label, color, sort_order, parent, active }` extend or edit the default options of a
  list by value; `active: false` hides an option for new values; an empty `sort_order` keeps the default's position.
- The `custom_field` row named `"_form"` (`FORM_ROW`, `@shared/model/arrangement`) is the form layout designer's
  arrangement of a table's form — `options: { tabs: [{ label, sections: [{ label, fields }] }] }` — never a field:
  the engine cleans it (`cleanArrangement`) and serves it as `def.form.arrangement` (docs/spec/UI_RECORDS.md §11).

`orgSchema(ctx)` returns the effective definitions (`def(key)`, `lookup`, `choices(list)`, `lists()`), cached per
organisation and revalidated on every request with one small query, so a change made on another cloud instance is
seen at once.

## 12. HTTP API

Mounted under `/api/o/:org` (signed-in member, or a support session). JSON in and out; errors are
`{ "error": { "code", "message" (Persian), "details" } }` with codes `validation` (400, `details.fields`),
`bad_request`, `forbidden` (403), `forbidden_field` (403, `details.fields`), `not_found` (404 — also for records the
caller may not read), `version_conflict` (409, `details.version`), `locked` (409), `transition` (409), `conflict`
(409, guards), `duplicate` (409, unique fields in `details.fields`), `too_large` (413).

| method & path | body / query | response |
| --- | --- | --- |
| `GET /meta/tables` | | `{ tables: TableMeta[], choices: { [list]: Option[] } }` — readable tables with tenant fields/labels, visible fields, `can: { read, create }` |
| `GET /meta/tables/:key` | | `{ table, choices }` |
| `GET /r/:table` | `?q&sort&page&size&fields=a,b.c&filter=<json>&view&ids=a,b&total=false` | `{ rows, total, page, size, display }` |
| `POST /r/:table/query` | `{ filter, q, sort, page, size, fields, ids, view, total }` | same |
| `POST /r/:table` | field values | `{ row, display, meta }` |
| `POST /r/:table/agg` | `{ filter, q, groupBy, metrics, limit }` | `{ groups, rows, totals, display }` |
| `POST /r/:table/bulk` | `{ ids \| filter, data?, transition?, delete? }` (≤ 500) | `{ updated, failed }` |
| `GET\|POST /r/:table/export` | list params + `limit` (≤ 10 000) | `{ columns: [{ name, label, type }], rows: Cell[][], truncated }` (numbers as numbers, choices/refs as labels, «بله/خیر», ISO dates) |
| `POST /r/:table/import` | `{ rows: [{ header: cell }], mapping?, key?, dry_run? }` (≤ 1000) | `{ created, updated, errors: [{ row, field?, message }], dryRun, mapped }` — headers match field names or Persian labels; choice labels, members by e-mail/name, refs by number/display value, Jalali/Excel dates are understood; `key` (e.g. `number`) updates matches; `dry_run` validates everything and rolls back |
| `GET /r/:table/:id` | | `{ row, display, meta }` |
| `PATCH /r/:table/:id` | changed values + `version` (or `If-Match`) | `{ row, display, meta }` |
| `DELETE /r/:table/:id` | `?version` | `{ ok: true }` |
| `POST /r/:table/:id/transition` | `{ to, data?, version? }` | `{ row, display, meta }` |
| `GET /r/:table/:id/journal` | `?kinds=comment,work_note&limit&before` | `{ entries: [{ id, kind, visibility, body, author, created_at, data, attachments }], display }` |
| `POST /r/:table/:id/journal` | `{ kind: "comment" \| "work_note", body, attachments? }` | `{ entry, display }` |
| `GET /r/:table/:id/history` | `?limit&before` | `{ entries: [{ id, field, label, type, old, new, actor, at }], display }` |
| `GET /r/:table/:id/links` | | `{ links: [{ id, kind, direction, label, other: { table, id, number, display, state, state_label }, note, created_at, created_by }] }` |
| `POST /r/:table/:id/links` | `{ kind, table, id, note? }` | `{ link }` |
| `DELETE /r/:table/:id/links/:linkId` | | `{ ok: true }` |
| `POST /r/:table/:id/watch` | `{ user_id? }` | `{ watching, watch_list }` |
| `DELETE /r/:table/:id/watch` | `?user_id` | `{ watching, watch_list }` |
| `GET /r/:table/:id/attachments` | | `{ attachments: [{ id, name, mime, size, sha256, uploaded_by, created_at, previewable }], display }` |
| `POST /r/:table/:id/attachments` | `multipart/form-data`, field `file` | `{ attachment }` |
| `DELETE /r/:table/:id/attachments/:attachmentId` | | `{ ok: true }` |
| `GET /attachments/:id/content` | `?inline=1` (raster images only) | the bytes, safe headers |
| `POST /blobs/missing`, `PUT /blobs/:sha256` | Windows app: contents of attachments added offline | `{ missing }`, `{ ok, stored }` |

The virtual table `user` answers `GET /r/user?q=` (members for pickers: `id`, `name`, `email`, `title`, `role`,
`is_active`).

## 13. Synchronisation

- Every TableDef with `features.sync !== false` is a synchronised root automatically (entity = its key; generated in
  `src/server/sync/registry.ts` from `onTableRegistered`), and so are the engine's `journal`, `history`,
  `attachment`, `link`. Nothing to register by hand; a new synced table or column needs a `SYNC_PROTOCOL` bump.
- **Push** (cloud applying a Windows app's rows): judged by the access provider (create / write / delete,
  `rowAccess`) and the engine's values (types, lengths, choices) — a refusal comes back with the Persian reason and
  stays in the desktop's outbox; fields the account may not see or write, retired custom fields and pinned columns
  (`id`, `org_id`, `no`, `created_*`) keep the cloud's values; references are not re-checked; journal and history rows
  are immutable (only removal). History is not written again (the desktop's own rows travel); events are emitted with
  `via: "sync"`. Hooks do not run again (react to events instead). What the API holds a member to holds for their push
  too: a change of the state field is a transition of the model from the stored state that the account may take
  (`canTransition`, its `requires`, its guard, the modules' `validateTransition`) — never a jump; on a record the account
  reaches only as its requester (provider `writeMode` "requester") system and readonly fields keep the cloud's values
  and the engine's effects of the transition (resolved/closed stamps, `active`) are the cloud's own; fields a module
  derives from other data are recomputed by its `derivePush` hook (knowledge: compiled contributors, audience units,
  the internal flag; of the base columns only the access anchors `unit_id`, `domain_id` and `workspace_id` — an
  alert's from its CI, security records' secure workspace) and never taken from the push; a pushed deletion asks the
  module's `validatePushDelete` (the delete rules its `beforeWrite` holds a web delete to: held evidence is not
  deleted); a new journal entry or history row is in the account's own name
  or has no author (the system's note of something module code did while they acted) — never someone else's — and
  anything but their own comment or work note needs write access to its record. The push applies its rows in the
  aggregates' order, then the modules' own (`registerPushOrder` in `src/server/sync/registry.ts`: a ledger after the
  record it traces, in its own sequence — a Windows app sends its outbox in whatever order it reads it), and a module
  judging a row may look at the push's other rows (`pushBatchOf(ctx)`): ITAM takes a device's custody rows and status
  periods as one segment and decides their links and times within the push's bounds (docs/modules/itam_FA.md
  «تغییرهای برنامهٔ ویندوز»). A push that lost to a newer cloud copy (`conflict`) gets that copy back through the pull's projection
  (`replicaRows`: readability, replica-only fields, hidden fields, redaction, side filters) — a row the account may not
  read is answered `skipped`, with nothing of it.
- **Numbers**: both sides allocate from their own counter; on a clash the cloud gives the pushed record the next free
  number (`allocateNumber`) and the desktop takes it over.
- **Revisions are transaction ids** (SYNC_PROTOCOL 16; `src/server/sync/snapshot.ts`, migration `0100_xid_revisions`):
  the sync trigger stamps a synced row with `pg_current_xact_id()` of the transaction writing it (bigint, 64-bit, never
  wraps) — no counter row, no lock, any commit order. A Windows app's own database keeps the server's revisions as
  they came (`itsm.mode = 'desktop'`: the trigger queues the outbox instead — except a write inside the demo scope of
  the row's organisation, which never leaves the app). The migration is numbered after the demo pack's `0098`/`0099`
  (1.1.0-beta servers ran those already; `migrate` applies every id missing from `sm_migrations` in list order), so its
  `sm_sync_touch()` is the last definition everywhere and must keep 0099's demo rule (`tests/sync-trigger.test.ts`). It
  also restarts what held counter values: Windows apps' cursors (`sm_devices.cursor`) and a demo pack's `purge_mark`. A push's conflict check is «the stored
  revision differs from the one the app last saw» (ids are not in commit order) and the newer `updated_at` wins.
- **Pull cursor = a snapshot** (`pg_current_snapshot()`, `xmin:xmax:xip`). A pull session reads the rows whose writer
  is visible in the session's snapshot (`snap`, taken by its first page) and was not visible in the cursor of the last
  complete session (`since`): `rev < snap.xmax and rev ∉ snap.xip and rev >= since.xmin and (rev >= since.xmax or rev ∈
  since.xip)` — plain comparisons on `rev`, so `(org_id, rev)` answers them. Exact: a transaction still open at the last
  look is in its xip and comes later (a long transaction only delays its own rows), a row comes again only when it was
  written again. Pages of `PULL_PAGE` (1000) rows in `(rev, id)` order across every synced table and the members'
  accounts (`after = rev:id`; the rows of one big transaction share a revision and are split by id, never dropped).
  Every statement of a page keeps to the window (short statements of 24 tables each — no transaction holding locks on
  every table): a row written again after `snap` is left to the next session (its new revision is not visible in
  `snap`), never sent twice or half-changed. The answer
  carries `cursor` (the session's `snap` once it is complete), `snap`, `after`, `has_more`, `full` (a session from no
  cursor) and `epoch`. Every pull names its protocol: anything but `protocol=16` — a 1.0 or 1.1.0-beta app sends none,
  with numeric cursors, 0 included — is refused with «update the app» (400) before any page is read, like a push of
  another protocol; such an app is never served a page it would misread. `sm_devices.cursor` keeps the `xmin` of a
  device's last complete session (the oldest transaction id it had not seen), and `sm_devices.sync_protocol` the protocol
  its last register, push or pull named — refused ones included, before anything else is read (0: a pull that named
  none), on the account's own device only — so that the platform console counts and marks the apps it cut off
  (`deviceOutdated`; a 1.1.0-beta app reports this build's version string).
- **Pull filter**: only rows the linked account may read (provider + row rules; side rows follow their record;
  internal journal entries need the field group; history of hidden fields is left out); hidden fields are not sent; a
  row that changed but is no longer readable is sent as a **tombstone** and the desktop deletes it with its journal,
  history, attachments and links. In a session from nothing (`full`) the Windows app also records what it received
  (`sm_sync_seen`) and at the session's end drops the organisation's engine rows it did not receive and that wait for
  no upload — tombstones removed for good, what a restore took back — then runs one more session at once (rows that
  changed while it ran).
- **Sync epoch** (`sm_org_sync.epoch`; the pull's `epoch` is `<organisation>.<member scope>`): a Windows app whose epoch
  differs is told to `reset` and reads everything again. Bumped (`bumpSyncEpoch`, a timestamp-based value so a database
  restored from an older backup still moves past every epoch handed out before) by `karizctl restore` (the restored
  database, before it takes the live name), a tenant backup restore and a transaction-id regression (the high-water
  mark `sm_meta sync.xid_high`, raised by `xidRegressionWaiting` once a minute per process and checked at every
  startup: ids below it mean the database went back — restored into another cluster — and every organisation's epoch
  moves once, when its rows are restamped: below). A pull whose cursor is ahead of the database's next transaction id
  runs the check at once; the database not gone back, that app alone is told to `reset`. A restored Windows app
  database starts its next pull from nothing (`resetSyncCursor`; it empties only a cursor that is there — a standalone
  app gains no `sync.*` key, which is what `refuseLinkedDesktop` takes for a link).
- **Restored into another cluster** (a restore on a newly installed server, a web database moved by dump): pg_restore
  loads the data before the triggers exist, so rows keep the old cluster's revisions — possibly far above the new
  cluster's ids, where a full read's window (`rev < snap.xmax`) leaves them out and the app's sweep then drops its
  copies — and so do the cursors, demo marks and the purge watermark (an old cluster's watermark is never visible in a
  snapshot here: every pull with a cursor would read everything again). Every synced row above the restamping
  transaction's id takes that id (`itsm.applying` keeps timestamps), `sm_devices.cursor` goes to 0, a tombstoned demo
  pack's `purge_mark` to the finishing transaction's id + 1, a non-zero `sm_org_sync.purged` to that id
  (`notePurgedHere`: the apps' first full read sees it), every organisation's epoch moves and the mark starts again —
  the epochs and the mark only once every row is back below the ids, so the mark is never lowered without the restamp.
  `karizctl restore` does it in one transaction on the restored database before any server opens it
  (`BUMP_ALL_EPOCHS_SQL` → `RESTAMP_SQL`, `RESTAMP_ROWS` shared with 0100). A database in use does it in short
  resumable steps under the migrations' lock (`restampSteps`: per synced table at most `RESTAMP_BATCH` rows found
  through its `(org_id, rev)` index, progress in `sm_meta sync.restamp`; the last step bumps the epochs and lowers the
  mark): `migrate()` runs them all at start-up (`checkXidRegression`; a failure leaves the regression seen and does not
  stop the start), `scripts/migrate-db.mts` after the schema's steps (the operator's offline path), and the web
  version treats a regression like a schema that is not current — `/api` answers 503 `migrating` (one-query cold
  start, `db/schema-check.ts` `coldStart`) while the steps run within each answer's budget after it (`src/server/cloud.ts`;
  not with `AUTO_MIGRATE=false`: migrate-db then). Until the last step no pull is answered: one that finds the
  regression (`xidRegressionWaiting`, every pull until it is handled once a process saw it) answers 503 `migrating` and
  hands it to the runtime (`ServerConfig.xidRegression`: the web instance answers every request so until its steps are
  done; otherwise `restampInBackground` in the process). Not on a Windows app's database nor before 0100 (only the
  epochs and the mark). Instances that start together take turns on the lock; exactly one finishes
  (`tests/sync-xid-pg.test.ts`; the web: `tests/web-startup.test.ts`).
- **Tombstone purge**: `purgeArchived` removes archived records' tombstones after 30 days and raises
  `sm_org_sync.purged` to the newest revision removed (`notePurged`); a cursor that does not see it never received those
  tombstones and is reset (full read, which drops them). Any other hard delete of rows a Windows app may hold must leave
  a tombstone or raise the watermark in the same transaction: for live rows (no app saw them go) to the transaction's
  own id (`notePurgedHere`, which replaces the watermark: a cursor that sees this transaction sees every one committed
  before it). The demo pack's purge does both (`modules/demo/purge.ts`): with apps active it tombstones the pack's rows,
  what the platform computed meanwhile and the people's memberships, and `finalizeDemo` removes them once every
  device's cursor passed `purge_mark` (the last tombstoning transaction's id + 1) — raising the watermark to the newest
  one, so an app left behind by a forced finalisation reads everything again; with no app active it deletes at once and
  raises the watermark to its own transaction (`tests/demo-sync.test.ts`).
- **Scope epochs** (`sm_scope_epochs`): bumped per member when what they may read changes — by trigger on their
  membership (role, per-area access, activation), on the access tables (0007), on participant grants (0053: a service's
  owner and product owner, delegations, approvals; a delegation that starts or ends with time through the job
  `approval.delegation_epoch`) and by `bumpScopeEpoch(q, orgId, userId)` for everything else. A
  desktop whose epoch is behind is told to `reset` and reads everything again (tombstoning what left its scope).
- **Fields kept out of replicas** (`FieldDef.noSync`: a requested item's sensitive answers) never go down to a
  Windows app, even for people holding their field group: pulls leave them (and their history) out, a push never
  empties them (the replica never had the value; a value typed on the Windows app is taken), and the Windows app
  clears what it holds once nothing waits for upload. The web version alone keeps them.
- **Secrets** never travel (each runtime seals its own). **Attachment contents** are fetched lazily by the desktop
  (`DesktopBridge.fetchBlob` → the cloud's content route) and those added offline are uploaded after the push.

## 14. Storage and DDL

- One physical table per TableDef: `ddlFor(def)` emits idempotent SQL — base columns, a typed column per field
  (`FIELD_TYPES[type].sql`; bool not null with its default), `no` + generated `number`, indexes (`(org_id, no)`
  unique, `(org_id, rev)`, `(org_id, updated_at desc, id desc)` and `(org_id, created_at desc, id desc)` for live
  rows — the default list orders —, the state field,
  every `index: true` field — GIN for arrays —, `unique` fields/combinations), the `sm_sync_touch('<key>')` trigger
  and row level security.
- Scale (docs/PERFORMANCE_FA.md): numbered tables with search fields store their normalised search document in a
  generated column `search_<hash>` (never returned, never synced) with a trigram index where pg_trgm exists — only
  the search fields every reader may see (`storedSearchFieldsOf`: no field-group fields; those are searched on their
  own columns for callers who see them, so nobody finds a row by text hidden from them); task
  tables get a partial open-queue index `(org_id, <group>, updated_at desc) where active` and a BRIN on `opened_at`;
  archivable tables (numbered, `active` + `closed_at`, no parent scope) get `<table>_arc` and the nightly
  `engine.archive` job (setting `archive: { enabled, years }`). Conditions compile to plain comparisons at positive
  positions with `toSql(…, { filter: true })` — use it whenever the SQL is only a WHERE/ON filter.
- Migration `0006_engine_tables` runs `ddlForAll()`; `reconcileSchema(db)` runs after the migrations on both
  runtimes and re-applies the generated DDL whenever its hash (`sm_meta` `engine.ddl`) changed. So a new table or
  field needs **no migration**. Changes are additive only: a removed field keeps its column, a type change keeps the
  old column type, renames are not detected — write a migration for those (and bump `SYNC_PROTOCOL`).
- `npm run schema` writes the generated DDL into `supabase/schema.sql`; `npm run check:schema` fails when it is stale
  — run `npm run schema` after changing any TableDef.
- Engine tables (`0005_engine`): `sm_meta`, `sm_numbers`, `sm_jobs`, `sm_history`, `sm_journal`, `sm_attachments`,
  `sm_blobs`, `sm_links`, `sm_scope_epochs`.

## 15. Testing

- `tests/engine-helpers.ts`: `engineOrg()` (an in-memory server with an organisation and its owner client;
  `member(role)` adds a signed-in member; `ctxOf(userId)` a context for direct service calls), `upload()` (multipart),
  `raw()` (binary GET), `outbox(db, org, kind?)`, `PNG`.
- Register test tables at the top of the test file with `registerTable(def)` (before the first server is made —
  migrations create them); `setAccessProvider(fake)` to prove access rules (`tests/engine-access.test.ts`);
  `systemCtx(cfg, orgId)` for system writes; `tick(cfg)` to run jobs and deliver events; `onRecordEvent` to observe
  them; the desktop↔cloud pattern of `tests/engine-sync.test.ts` (an in-process cloud and desktop with a
  `SyncClient` whose fetch calls the cloud app).
- Existing suites: `engine-conditions` (evaluate ↔ SQL parity), `engine-records`, `engine-activity`, `engine-jobs`,
  `engine-ddl`, `engine-access`, `engine-sync`, `engine-performance` (EXPLAIN of the generated page queries on 20 000
  rows: index scans only; display values in one query per referenced table).

## 16. Rules of thumb

- Describe the data as a TableDef; reach for hooks only for behaviour the metadata cannot express, and for special
  pages only where the generic list/form is not enough.
- Never write engine tables with raw SQL from module code (no history, no events, no validation, no access checks):
  use `createIn/updateIn/transitionIn/removeIn` inside `ctx.write`, or `systemCtx` for background work.
- Never call a model or external service inside a transaction or a hook — enqueue a job, subscribe to events.
- Filter with conditions through the engine (`toSql` + `readable`), never by concatenating values into SQL.
- Every new read path of your own must start from `readable(ctx, def, alias, params, env)` and strip fields with
  `visibleFields` (or reuse `list`/`get`). A context whose reads leave the system (`ctx.withoutDemo`: the record API,
  a schedule's e-mail, a messenger's answers) gets no row of the demo pack from it (docs/DEMO_FA.md).
- Use `version` for concurrency, `number` for people, `id` for machines.
