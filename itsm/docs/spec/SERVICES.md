# Platform services — index

Three services sit between the record engine (docs/spec/ENGINE.md, docs/spec/ACCESS.md) and the ITSM modules. Each is
installed once per process from `src/server/routes/modules.ts` (`installNotify()`, `installSlaService()`, and
`installFlows()` through `routes/flows.ts`); a module never re-implements what they do — it declares fields, raises
events and registers hooks or sources. They are wired to each other: flows' «ارسال اعلان» goes through the notification
service, «درخواست تأیید» through the approvals service, and «انتظار زمانی» «به وقت کاری» counts on the SLA calendars
(`src/server/modules/notify/flows.ts`, `src/server/modules/sla/flows.ts`; tests `tests/flows-services.test.ts`).

| service | spec | server | UI |
| --- | --- | --- | --- |
| Notifications, e-mail, inbox | [services/notify.md](services/notify.md) | `src/server/modules/notify` | `src/ui/modules/notify` |
| Calendars, SLAs, approvals, rules of records | [services/sla.md](services/sla.md) | `src/server/modules/sla` | `src/ui/modules/sla` |
| Flows (no-code automation) and schedules | [services/flows.md](services/flows.md) | `src/server/modules/flows` | `src/ui/modules/flows` |

## Notifications — [services/notify.md](services/notify.md)

A module does not send anything itself. Its records' engine events (`record.created`, `record.assigned`,
`record.commented`…) already reach the built-in and organisation rules; for its own moments it emits
`record.<name>` with `emitEvent` (people in `data.users`) and lets a `custom` rule name it, or — when the module picks
the people — calls `notifyPeople(tx, orgId, { table, id, users, subject, body, … })` inside its write. Either way the
service renders every message per recipient under that recipient's access (no access → nothing, hidden fields
«(محدود)»), applies preferences, digests and quiet hours, delivers by jobs and logs each attempt. Modules with on-call
rotas register `registerOnCallSource`; tests swap transports with `setTransportFactory`/`setMailboxOpener`.

## Calendars, SLAs, approvals and rules — [services/sla.md](services/sla.md)

A module gets SLAs, approvals and record rules by shape, not by code: a task table with `sla_due` and an `approval`
field takes part as soon as the organisation defines SLA definitions, approval rules, business or assignment rules,
UI policies, a priority matrix or categories for it — the service's hooks on `"*"` apply them on every write path
(API, imports, flows, jobs, sync pushes). Business-time arithmetic (`@shared/sla/calendar`: `addBusiness`,
`businessBetween`) is shared by server and UI. Modules plug in with `registerPriorityDefault(table)`,
`registerApproverSource(of, fn)` (levels `{ kind: "owner", of }`) and `setOnCallResolver`, ask ad-hoc approvals with
`requestApproval`/`requestApprovalIn`, and react to `record.sla_warning`, `record.sla_breach`,
`record.approval_requested` and `record.approval_decided` with `onRecordEvent`.

## Flows — [services/flows.md](services/flows.md)

Organisations automate a module's records without code: flows start on record events, schedules, webhooks, manual
runs or catalog orders, and run as a configured identity through the access provider. A module adds nothing for its
tables to be usable in flows (any engine table works); it may add node types with `registerFlowStepHandler` (the
notification and SLA services do, for «ارسال اعلان» and «درخواست تأیید»), AI skills with `registerFlowSkill`, start
catalog flows with `startCatalogFlows`, and wake a waiting step of its own with `resumeFlowWait(tx, orgId, key, result)`
inside the transaction that decided. Records written by a run carry `$flow` in their events, so a module's own
subscribers can tell automation from people.

## Public pages without sign-in

What an organisation publishes on purpose is served without a session, and nothing else: modules mount endpoints on
`publicRoutes` (`src/server/routes/public.ts`, `/api/public/…`) and pages on `ModuleUi.publicRoutes` (the SPA's `/p/…`,
outside the signed-in shell, in `PublicFrame`; they read only `publicApi` from `src/ui/lib/api.ts`). Every public
request is rate limited per client (`rateLimit` in `src/server/http/ratelimit.ts`, `PUBLIC_LIMIT`: 120 a minute, 429
with `Retry-After` and a Persian message; counters per process), GETs are readable from any origin and marked
`noindex`. A handler opens no member context: it resolves the module's own published token (rotatable, revocable) to
an organisation, reads as the system and returns a projection of what was published — never record ids, numbers or
people. The service status page is the first: `GET /api/public/status/:key` (also `GET /api/v1/status/:key`, rate
limited) and the page `/p/status/:key` (`src/ui/modules/service_portfolio/PublicStatus.tsx`); the portfolio manager's
«انتشار عمومی» hands out that page's link. Public knowledge (KB-031, anonymous read ACC-004) plugs in the same way
once the knowledge module publishes bases for it (not built yet).
