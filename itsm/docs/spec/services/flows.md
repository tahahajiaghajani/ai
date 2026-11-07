# Flows — no-code automation and schedules

Flows («گردش‌کارها») let an organisation automate work without code: a **trigger** (a record event, a schedule, an
inbound webhook, a manual or test run, a catalog order) starts a **run** that walks a **graph** of steps — update or
create records, comment, notify, ask for approval and wait, wait for a condition or a duration, branch, run branches in
parallel and join them, loop over records, call an outside HTTP service, set variables, run a subflow, run an AI skill,
end. **Schedules** create records from a template on a recurring, Jalali-friendly schedule.

Everything is built on the record engine (docs/spec/ENGINE.md) and the access model (docs/spec/ACCESS.md): the
configuration is engine tables, reactions are `onRecordEvent` subscribers, background work is the job queue, runs act
through the access provider as their configured identity, and the UI is built with the record UI kit
(docs/spec/UI_RECORDS.md).

Contents: [1 Code](#1-code) · [2 Tables](#2-tables) · [3 The graph and its nodes](#3-the-graph-and-its-nodes) ·
[4 Triggers](#4-triggers) · [5 The executor](#5-the-executor) · [6 Data pills](#6-data-pills) ·
[7 HTTP step](#7-the-http-step) · [8 Plug-in points for other services](#8-plug-in-points-for-other-services) ·
[9 Schedules](#9-schedules) · [10 HTTP API](#10-http-api) · [11 Access](#11-access) · [12 UI](#12-ui) ·
[13 Runtimes and sync](#13-runtimes-and-synchronisation) · [14 Limits](#14-limits) · [15 Tests](#15-tests) ·
[16 Not built yet](#16-not-built-yet)

---

## 1. Code

| path | what |
| --- | --- |
| `src/shared/flows/types.ts` | graph, trigger, schedule, run and step types (UI and server) |
| `src/shared/flows/nodes.ts` | the node catalogue `NODE_TYPES` (labels, icons, ports, settings, outputs), trigger options, `FLOW_LIMITS` |
| `src/shared/flows/template.ts` | data pills: `renderTemplate`, `renderText`, `renderBody`, `pillsOf`, `compareData` |
| `src/shared/flows/schedule.ts` | `nextOccurrence`, `scheduleProblem`, `describeSchedule`, `parseCron`, `SCHEDULE_PRESETS` |
| `src/shared/flows/validate.ts` | `validateGraph`, `triggerProblems`, `cleanGraph`, `emptyGraph`, graph helpers |
| `src/shared/tables/flows.ts` | TableDefs `flow`, `flow_version`, `flow_connection`, `schedule` |
| `src/server/db/migrations/0010_flows.ts` | runtime tables `sm_flow_runs`, `sm_flow_run_steps`, `sm_flow_waits`, `sm_flow_timers` |
| `src/server/modules/flows/executor.ts` | `startRun`, `executeRun`, `resumeFlowWait`, `cancelRun`; job handlers `flows.run`, `flows.resume`, `flows.timer`, `flows.recheck` |
| `src/server/modules/flows/nodes.ts`, `http.ts` | built-in step handlers |
| `src/server/modules/flows/registry.ts` | `registerFlowStepHandler`, `registerFlowSkill`, `setFlowBusinessClock` |
| `src/server/modules/flows/triggers.ts` | record-event triggers, condition re-checks, `startCatalogFlows`, `resolveRunAs` |
| `src/server/modules/flows/scheduler.ts` | the `flows.scheduler` job: scheduled flows and `schedule` records |
| `src/server/modules/flows/hooks.ts` | engine hooks and record meta of the four tables, `flowsGrant` |
| `src/server/modules/flows/service.ts` | publish, test and manual runs, run history and detail, cancel, approvals, webhooks |
| `src/server/routes/flows.ts` | `/api/o/:org/flows/*` and the public `/api/hooks/flows/:id` |
| `src/ui/modules/flows/*` | designer, run history and run page, schedule editor, record-page extensions |

The server module installs itself when the app is assembled (`installFlows()` from `routes/flows.ts`, mounted in
`routes/modules.ts`; the webhook router in `app.ts`).

## 2. Tables

Engine tables (module `flows`, area `flows`; generic lists and forms at `flows`, `schedules`, `flow-connections`):

**`flow`** (`sm_flows`) — `name` (unique), `active`, `description`; the trigger: `trigger`
(`record | schedule | webhook | manual | catalog`), `trigger_table`, `trigger_events`
(`created, updated, state_changed, assigned, commented, deleted`), `trigger_fields` (record.updated only: run only when
one of these changed), `trigger_condition` (an engine condition on `trigger_table`), `schedule` (a `ScheduleSpec`),
`catalog_item`, `webhook_token` (engine secret); the identity: `run_as` (`trigger_user | user | system`),
`run_as_user`; the draft `graph` (json, not audited); published state: `version_no`, `version_id`, `published_at`,
`dirty` (the draft differs from the published version).

**`flow_version`** (`sm_flow_versions`) — immutable: `title`, `flow_id`, `version_no` (unique per flow), `note`,
`trigger` (snapshot of the trigger settings) and `graph`. Created only by publishing; updates and deletes are refused.

**`flow_connection`** (`sm_flow_connections`) — an outside service the HTTP step may call: `name`, `active`,
`base_url`, `hosts` (more allowed hosts, exact or `*.example.com`), `auth` (`none | bearer | basic | header | query`),
`auth_name` (header or query parameter name), `username`, `secret` (engine secret), `headers` (static, json),
`timeout` (1–60 s), `description`. On the web version `base_url` and hosts must be public https addresses.

**`schedule`** (`sm_schedules`) — recurring record creation: `name`, `active` (default off), `table_key`, `spec`
(`ScheduleSpec`, default the first of each Jalali month at 09:00), `template` (`{ field: value-with-pills }`, writable
fields of the table only; required to activate), `run_as` (the member records are created as, default the creator),
`description`. `spec` and `template` are edited in the record page's «تکرار» panel, not as JSON; `meta.schedule` =
`{ description, next_at, last_at, last_error }`.

Runtime tables (migration `0010_flows`, plain tables of the runtime that executes the runs, never synchronised —
`tests/sync-registry.test.ts` lists them as local): `sm_flow_runs` (one row per run: flow, version, `state`
`running | waiting | completed | failed | canceled`, `test`, trigger kind/table/record, `actor_id`, identity `run_as` +
`run_as_kind`, `depth`, `parent_run_id`, `context` (the data), `runtime` (tokens and frames), `current_nodes`,
`steps_count`, `error`, lease, times), `sm_flow_run_steps` (the step log, unique `(run_id, key)`), `sm_flow_waits`
(what waiting steps wait for), `sm_flow_timers` (the scheduler's plan). Finished runs are deleted after 30 days
(failed ones after 90).

## 3. The graph and its nodes

```json
{
  "nodes": [
    { "id": "trigger", "type": "trigger", "config": {} },
    { "id": "u1", "type": "update_record", "label": "اولویت فوری", "config": { "values": { "priority": "1" } }, "position": { "x": 0, "y": 120 } }
  ],
  "edges": [{ "id": "trigger-out-u1", "source": "trigger", "target": "u1" }],
  "layout": { "direction": "TB" }
}
```

An edge leaves an output **port** of its source (`port`, default `"out"`). One edge per port, except the parallel
node's `out`. Exactly one `trigger` node, no edges into it, **no cycles** (repetition is `for_each`; polling is
`wait_condition`). Steps not reachable from the trigger are ignored (a warning).

| type | ports | settings (config) | outputs `{{steps.<id>.output.…}}` |
| --- | --- | --- | --- |
| `trigger` | out | — (the flow record's trigger settings) | — |
| `update_record` | out, error | `table` (default: trigger table), `record` (default `{{trigger.record.id}}`), `values` `{field: template}` | `id`, `record` |
| `create_record` | out, error | `table`, `values` | `id`, `number`, `record` |
| `add_comment` | out, error | `table`, `record`, `kind` (`work_note` \| `comment`), `body` | `entry_id` |
| `notify` | out, error | `to` (recipients), `subject`, `body`, `table`, `record` | `recipients`, `sent` (+ the service's) |
| `approval` | approved, rejected, error | `approvers` (recipients), `rule` (`any` \| `all`), `title`, `message`, `table`, `record` | `decision`, `by`, `comment` |
| `wait_condition` | out, timeout | `table`, `record`, `condition`, `timeout` (duration), `poll` (minutes, default 60) | `matched`, `timed_out` |
| `wait_duration` | out | `mode` (`duration` \| `until`), `duration` `{amount, unit}`, `business`, `until` (template) | `due_at` |
| `branch` | yes, no | `mode` (`record`: `table`, `record`, `condition` \| `data`: `rules` `[{left, op, right}]`, `match` `all`\|`any`) | `result` |
| `parallel` | out (many) | — | — |
| `join` | out | `mode` (`all` \| `any`) | — |
| `for_each` | each, done, error | `source` (`query`: `table`, `condition`, `sort`, `limit` ≤ 500 \| `list`: `list` template) | `count` |
| `call_http` | out, error | `connection`, `method`, `path`, `query`, `headers` `[{key, value}]`, `body` (JSON text), `map` `[{name, path}]`, `timeout` | `status`, `ok`, `body`, `content_type`, mapped names |
| `set_vars` | out | `vars` `[{name, value}]` → `{{vars.<name>}}` | the variables |
| `subflow` | out, error | `flow`, `inputs` `[{name, value}]`, `wait` (default true) | `run_id`, `state`, `outputs` |
| `ai_skill` | out, error | `skill`, `inputs` | what the skill returns (`text`, `data`) |
| `end` | — | `outcome` (`completed` \| `failed`), `message`, `outputs` (a subflow's result) | — |

Recipients (`to`, `approvers`): `{ users: [ids or pills], fields: [user fields of the record], groups: [ids] }`.
Record conditions are the engine's `Cond` (docs/spec/ENGINE.md §3), evaluated through the run's identity; data
comparisons use `eq ne gt gte lt lte contains ncontains empty nempty` (numbers compare as numbers, Persian digits
included). A step whose settings say nothing about the table works on the trigger's table; runs without a record use
the flow's `trigger_table`.

The validator (`validateGraph`, shared by the designer and the server) checks shape, ports, cycles, reachability,
required settings, field names (unknown or read-only), joins and parallels with too few edges, pills naming steps that
do not exist or do not run before, and `item` outside a loop. Errors block publishing and test runs.

## 4. Triggers

Every trigger matches against the flow's **published** version (`flow_version.trigger`), never the draft, and only
active flows start.

- **Record events** (`onRecordEvent("flows.triggers")`): event kind ∈ `trigger_events`, table = `trigger_table`;
  `record.updated` with `trigger_fields` needs one of them in `changed`; `trigger_condition` is evaluated on the
  current record as the member who acted (`is_me` = that member; deleted records: on the stored row). Events applied
  from a Windows app's push (`via: "sync"`) are skipped — the Windows app ran its flows. `{{trigger}}` =
  `{ kind: "record", table, id, number, event, actor, at, changed, changes, from?, to?, assigned_to?, entry? }`.
- **Schedule**: `schedule` spec (§9). `{{trigger.scheduled_at}}`.
- **Inbound webhook**: `POST /api/hooks/flows/:id` with the flow's key as `Authorization: Bearer <key>`,
  `X-Flow-Token` or `?token=`; JSON (or text) body ≤ 256 KB → `{{trigger.body}}`, `{{trigger.query}}` (without the
  key), `{{trigger.headers}}` (`x-*`, content-type, user-agent; never keys or signatures). Answers `202 { ok, run }`;
  unknown, inactive or non-webhook flows `404`, a wrong key `401`. Keys come from `POST /flows/:id/webhook-token`
  (shown once, stored sealed). Rate limit 120 per minute per flow and per address.
- **Manual**: `POST /flows/:id/run` (optionally with a record and `inputs` → `{{trigger.inputs}}`), or «اجرا» on the
  flow's page. A manual flow is also what `subflow` runs.
- **Test**: `POST /flows/:id/test` runs the draft (or an unsaved `graph`) as the caller, on a chosen record — real
  effects, marked `test`.
- **Catalog order**: the catalog module calls `startCatalogFlows(tx, orgId, { item, table, id, actorId, inputs })`
  inside the write that places the order; flows whose `catalog_item` equals `item` start (`{{trigger.inputs}}`).

**Run identity** (`resolveRunAs`): `system` → the platform's service role (`systemCtx`: everything in the
organisation); `user` → `run_as_user` (a member, e.g. a service account) through `memberCtx`; `trigger_user` → the
member who acted (record events, manual and test runs), else `run_as_user`, else the member who published the
version. Choosing `system`, or another member than oneself, needs `admin` in the `flows` area. Test runs always act as
the caller.

## 5. The executor

A run is a set of **tokens** walking the graph; each token has a stack of **frames**: a `fork` frame per parallel
split and a `loop` frame per `for_each`. `executeRun` takes a lease on the run (one worker at a time), then executes
ready tokens one step at a time, round robin, until all wait or end or the job's budget is spent (a `flows.run` job
continues). Deterministic: the same state gives the same next step.

- A step's outcome moves its token along a port. No edge → the path ends; its innermost frame counts it.
- `parallel`: one token per edge (a fork frame). `join` (`all`): continues once every branch reached it or ended —
  branches that end without reaching the join are not waited for; `any`: the first arrival continues at once, later
  ones are absorbed. If no branch reaches the join, the parallel part simply ends.
- `for_each`: reads the items (as the run's identity, with `$labels`), then runs the `each` path once per item
  (`{{item}}`, `{{item_index}}`); when all iterations ended, the token continues on `done`.
- `end` ends the whole run (all tokens, all waits) as `completed` or `failed` with `outputs`.
- A failing step takes its `error` port when connected (`{{steps.<id>.error}}`), else the run fails.

**Persistence and idempotency.** After every step the run's state is saved with the step's log row. Steps that write
records are **transactional**: their writes, the step log and the run's state commit in one transaction of the run's
identity (`ctx.write`) — exactly once; a failure rolls the writes back. Steps that call outside services run outside
any transaction (at least once) and get a stable key `s<seq>` per step; the HTTP step sends
`Idempotency-Key: <run>:<key>`. A run whose lease is lost or that was cancelled aborts the step's transaction.

**Waits** (`sm_flow_waits`) resume through the job queue: a timer (`flows.timer` at `due_at`), a result
(`resumeFlowWait` → `flows.resume`), or a record event on the record a `wait_condition` watches
(`onRecordEvent("flows.waits")` → `flows.recheck`). Cancelling a run (or its end) lets waiting steps withdraw
(`cancel` of the handler) and cancels open subflow runs.

**Guards**: at most `FLOW_LIMITS.steps` (1000) steps per run — then the run fails as a probable endless loop; records
written by a run carry `$flow: { run, flow, depth }` in the events they cause, and a flow those events would start at
depth > `FLOW_LIMITS.depth` (5) does not start; subflows add one level and stop at the same depth; loops read at most
500 items; graphs have at most 200 nodes.

## 6. Data pills

`{{ expression }}` inside any setting:

| root | meaning |
| --- | --- |
| `trigger.*` | the trigger's data; `trigger.record` = the trigger record as the run's identity reads it |
| `steps.<id>.output.*`, `steps.<id>.error` | an earlier step's output or error |
| `vars.*` | variables of `set_vars` (and a subflow's caller's inputs are `trigger.inputs`) |
| `item`, `item_index` | the current item of the innermost loop |
| `now`, `today`, `now + 2h`, `today - 1w` | the clock (units m, h, d, w), in the organisation's time zone |
| `jalali`, `jalali.year/month/day/month_name/weekday/date` | today in the Jalali calendar |

Records (trigger, items, step outputs) carry `$labels`: the display text of references, choices, yes/no and Jalali
dates — `{{trigger.record.$labels.assigned_to}}`. A value that is exactly one pill keeps its type (a number, an
array); pills inside text are written out (lists joined with «، »). Paths are those of `pickPath`
(`items[0].id`, `items[name=cpu].value`). A pill naming nothing is empty. JSON bodies may hold bare pills —
`{"priority": {{trigger.record.priority}}}` — which keep their type.

## 7. The HTTP step

Only to a `flow_connection`: the URL is `base_url` + `path` (or an absolute address) + `query`, and its host must be
the base host or one of `hosts`. https only (the Windows app may use http on its own network). On the web version the
platform's SSRF guard resolves the host (public addresses only) and refuses redirects. The connection's secret is
applied as `Authorization: Bearer`, Basic, a header or a query parameter and never reaches a log (steps' inputs are
logged with secret-looking keys masked). Timeout: the step's, at most the connection's, at most 60 s. The answer
(≤ 1 MB) is parsed when it is JSON; `map` picks values by path. Non-2xx answers and timeouts are errors (error port).

## 8. Plug-in points for other services

```ts
import { registerFlowStepHandler, registerFlowSkill, setFlowBusinessClock, resumeFlowWait, startCatalogFlows } from "@server/modules/flows";
```

**`registerFlowStepHandler(type, handler)`** implements (or replaces) a node type; it returns an unregister function.

```ts
interface FlowStepHandler {
  transactional?: boolean;                                   // run inside the identity's write transaction (s.tx)
  run(s: StepContext): Promise<StepOutcome>;
  resume?(s: StepContext, wait: WaitInfo): Promise<StepOutcome>;
  cancel?(a: WaitCancel): Promise<void>;                     // the run ended while this step waited
}
type StepOutcome = { port?: string; output?: object; vars?: object } | { wait: WaitRequest; output?: object } | { error: string; output?: object };
interface WaitRequest { kind: string; key?: string | null; dueAt?: number | null; data?: object }
// StepContext: cfg, orgId, run { id, flowId, flowName, versionNo, test, depth, actorId, runAsId }, node { id, type, label, config },
// stepKey (idempotency), ctx (the run's identity), tx, render(v), text(v), data, tz, triggerRecord, log(message)
```

The executor ships stand-ins for three node types; the services built next to it replace them by registering their own
handler — the merge only adds the registration:

- **Notifications** — `notify`. Stand-in: resolves the recipients and writes subject/body into the step log
  (`output.sent: false`). A service handler reads `s.node.config.to` (`{ users, fields, groups }`; resolve with the
  exported `recipients(s, spec)`), `subject`/`body` (`s.text(...)`), the record (`table`/`record` settings, default
  `s.triggerRecord`), filters recipients with `readersOf` and renders as each one with `memberCtx`, and should be
  `transactional: true` so its delivery jobs are queued with the step:

  ```ts
  registerFlowStepHandler("notify", {
    transactional: true,
    async run(s) {
      const to = await recipients(s, s.node.config.to);
      const sent = await queueNotifications(s.tx!, s.ctx, { to, subject: s.text(s.node.config.subject), body: s.text(s.node.config.body), record: s.triggerRecord });
      return { output: { recipients: to.users, sent } };
    },
  });
  ```

- **Approvals** — `approval`. Stand-in: a built-in approval decided on the run's page (`POST /flows/waits/:id/decide`,
  rules `any`/`all`). A service handler creates its approval rows in `s.tx` (`transactional: true`), returns
  `{ wait: { kind: "approval", key: "approval:<id>" } }`, and when the decision is made calls, inside its own write
  transaction, `resumeFlowWait(tx, orgId, "approval:<id>", { port: "approved" | "rejected", decision, by, comment })`;
  `resume` maps the result to the port (or the default does: `result.port`); `cancel` withdraws open approvals when
  the run is cancelled. Settings it reads: `approvers`, `rule`, `title`, `message`, `table`, `record`.

- **AI skills** — `ai_skill` runs a skill the AI layer registers; without it the step does nothing (`skipped`):

  ```ts
  registerFlowSkill({ key: "summarize", label: "خلاصهٔ رکورد", inputs: [{ name: "text", label: "متن" }],
    async run(s, inputs) { return { text: await summarize(s.ctx, String(inputs.text)) }; } });
  ```

- **Business time** — `wait_duration` with `business: true` asks `setFlowBusinessClock({ add({ cfg, orgId, from, ms, calendarId }) })`
  (the SLA calendar service); without a clock it counts calendar time and says so in the step log.
- **Catalog** — `startCatalogFlows(q, orgId, order)` (§4).

`GET /flows/catalog` tells the designer which services are installed (`services.notify`, `services.approval`,
`services.ai_skill`) and the registered skills.

## 9. Schedules

`ScheduleSpec`, in the organisation's time zone:

```ts
{ kind: "daily", time: "08:00" }
{ kind: "weekly", time: "08:00", weekdays: [0, 1, 2, 3, 4] }            // 0 = Saturday … 6 = Friday
{ kind: "monthly", time: "09:00", days: [1], last?: true, months?: [1, 4, 7, 10] }   // Jalali days and months
{ kind: "yearly", time: "09:00", month: 1, day: 1 }                     // Jalali (1 Farvardin)
{ kind: "interval", every: 15, unit: "minute" | "hour" | "day", start?: ISO }        // ≥ 5 minutes
{ kind: "once", at: ISO }
{ kind: "cron", expr: "30 9 * * 1" }                                    // Gregorian, 0/7 = Sunday
```

A monthly day the month does not have (31 in autumn) is skipped; `last` is the month's last day (29/30 in Esfand).
`SCHEDULE_PRESETS` offers every day, workdays, every Saturday, the first or last day of each Jalali month, each
season, Nowruz.

One `flows.scheduler` job per organisation (queued by the hooks when an active scheduled flow or schedule is saved)
runs every minute while something is scheduled: it plans each item's next occurrence in `sm_flow_timers` (re-planned
when the spec changes) and fires what is due **once** — the timer is claimed in the same transaction that starts the
run or creates the record. Missed occurrences are not replayed; a failed occurrence keeps its error
(`meta.schedule.last_error`) and the next one is planned. `schedule` records render `template` with the clock pills at
the occurrence's time (`{{jalali.month_name}}`, `{{today + 3d}}`, `{{schedule.name}}`) and create the record as
`run_as`.

## 10. HTTP API

Under `/api/o/:org/flows` (signed-in member); records through `/r/flow`, `/r/flow_version`, `/r/flow_connection`,
`/r/schedule`.

| method & path | body / query | answer |
| --- | --- | --- |
| `GET /catalog` | | `{ skills, services: { notify, approval, ai_skill }, limits }` |
| `POST /:id/validate` | `{ graph? }` | `{ problems: FlowProblem[] }` |
| `POST /:id/publish` | `{ note?, version? }` | `{ version: { id, version_no }, problems }` — 400 `{ details.problems }` with errors, 409 when stale |
| `POST /:id/webhook-token` | | `{ token, path }` (write access) |
| `POST /:id/run` | `{ table?, record_id?, inputs? }` | `FlowRunDetail` (after up to 3 s of inline execution) |
| `POST /:id/test` | `{ table?, record_id?, inputs?, graph? }` | `FlowRunDetail` |
| `GET /runs` | `?flow&state&test&page&size` | `{ runs: FlowRunView[], total, page, size }` |
| `GET /runs/:runId` | | `FlowRunDetail` `{ run, steps, waits, context, graph, can_cancel }` |
| `POST /runs/:runId/cancel` | | `{ ok, state }` |
| `POST /waits/:waitId/decide` | `{ decision: "approve" \| "reject", comment? }` | `{ ok, final }` (built-in approval) |
| `POST /api/hooks/flows/:id` | the webhook payload; key as Bearer, `X-Flow-Token` or `?token=` | `202 { ok, run }` |

Example — publish and activate:

```http
POST /api/o/{org}/flows/{id}/publish      {"note": "اولویت فوری برای چاپگرها", "version": 7}
PATCH /api/o/{org}/r/flow/{id}            {"active": true, "version": 8}
```

## 11. Access

Area `flows` (`registerArea` built-in, platform group). The four tables use the engine's provider: reading, creating,
changing flows, connections and schedules follow the caller's `flows` grant (owners and «مدیر» hold `tenant_admin`).

- Publishing, test runs and webhook keys need write access to the flow; setting `run_as` to `system` or to another
  member needs `admin` in `flows`.
- Manual runs: a member who may read a `manual` flow acting as the triggering member may run it; any other flow needs
  write access.
- Runs are shown to whoever may read their flow. Their **data** (the run's `context`, steps' inputs and outputs, wait
  details) only to `flows` administrators, the member who started the run, and those who may read the record it
  started with; others see states, steps and errors only.
- Steps act through the access provider as the run's identity; the `system` identity never shows data to a member
  except through the redaction above.

## 12. UI

`src/ui/modules/flows` («خودکارسازی» in the settings space): «گردش‌کارها» (`flows`, generic list/form + «طراحی»,
«اجرا» and the «اجراها» tab on a flow), «زمان‌بندی‌ها» (`schedules`, the «تکرار» panel with the schedule editor and
the template editor), «اتصال‌های HTTP» (`flow-connections`), «اجراهای گردش‌کار» (`flows/runs`), a run's page
(`flows/runs/:runId`: its graph with step statuses, the step log with inputs/outputs, waits and the built-in approval's
buttons, its data, «لغو اجرا»), and the designer (`flows/:id/design`):

- palette of steps by group (click adds after the selected step through its first free port; drag drops on the
  canvas); the canvas (@xyflow/react): connect ports (invalid connections — used ports, the trigger, cycles — are
  refused), drag, Delete/Backspace, zoom and fit, minimap; auto-layout with @dagrejs/dagre top to bottom or right to
  left;
- property panel generated from `NODE_TYPES` (tables, field values with field pickers, conditions with the records kit's
  `FilterBuilder`, recipients, durations, rows) with a data-pill picker that inserts `{{…}}` at the caret and lists
  only what runs before the step; the trigger panel edits the flow's trigger and run identity (schedule editor, webhook
  address and key);
- problems from `validateGraph` live on the nodes and in a list; «ذخیره» (draft), «انتشار» (new version; refused with
  errors), «فعال» (published flows only), «آزمایش» (a drawer: record, inputs, then the run's steps, with the statuses
  painted on the canvas).

Pure logic in `model.ts` (tests `tests/flows-ui.test.ts`).

## 13. Runtimes and synchronisation

The configuration tables synchronise like every engine table; runs, steps, waits and timers belong to the runtime that
executes them and never travel. A write runs its flows where it was made (the Windows app for its own writes; pushes
applied by the web version are skipped). A Windows app linked to the web version leaves its synchronised
organisation's schedules to the web version (`schedulesRunHere`); unlinked, it runs them itself. Condition waits
re-check on synchronised changes too. Webhooks are meant for the web version.

## 14. Limits

`FLOW_LIMITS`: 200 nodes, 1000 steps per run, 500 items per loop, depth 5, graph JSON 512 KB. Step outputs and loop
items are kept up to 64 KB / 16 KB (a preview beyond). HTTP answers ≤ 1 MB, webhook bodies ≤ 256 KB. Manual and test
runs execute inline for up to 3 s, then in the job queue.

## 15. Tests

`tests/flows-model.test.ts` (pills, bodies, comparisons, schedules and cron, validator), `tests/flows-executor.test.ts`
(every node type, waits resumed by timers, events and results, approvals — the stand-in and a registered service —,
error paths, subflows, the step and depth guards, identities, versions kept by running runs, cancel, registered
notify/AI handlers), `tests/flows-http.test.ts` (allow-list, auth from secrets never logged, bodies, mapping, errors,
timeouts, the SSRF guard), `tests/flows-schedule.test.ts` (recurring records with Jalali pills, scheduled flows, once
per occurrence, re-planning, errors, the scheduler job, linked Windows apps), `tests/flows-api.test.ts` (publishing,
immutable versions, run-as rules, run visibility and data redaction, manual runs, webhooks, catalog),
`tests/flows-ui.test.ts` (the designer's model). Helpers: `tests/flows-helpers.ts`.

## 16. Not built yet

- Retrying a failed run from the failed step; editing a waiting run.
- Flow-level variables declared up front, typed subflow inputs/outputs.
- A trigger on inbound e-mail (the notification service's inbound mail can start flows through a step handler or by
  calling `startRun` with a trigger of its own).
- Exactly-once delivery of record triggers in the rare case where an event's job fails after starting its runs (a
  retry may start them again); steps themselves are idempotent per run.
