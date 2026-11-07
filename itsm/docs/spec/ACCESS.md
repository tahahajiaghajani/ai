# The access model

Who may read, create, change, delete, approve and administer which records and fields — for every table of the record
engine, on every path: lists, records, aggregates and reports, exports, search, journal, history, attachments, links,
display values, the Windows app's sync, notifications and the AI layer. One policy, evaluated in two forms that are
proven equal: a SQL predicate for everything that reads sets of rows, and an in-memory evaluator for single-row
decisions and explanations.

Code: `src/shared/access` (areas, scopes, grants, roles, built-in catalogue, evaluator — imported by the UI too),
`src/shared/tables/access.ts` (the access tables), `src/server/access` (subject loading and caching, SQL generation,
the provider, hooks, services), `src/server/routes/access.ts` (HTTP API), `src/server/db/migrations/0007_access.ts`
(access version and scope-epoch triggers), `src/ui/modules/access` (admin UI). Persian admin guide:
`docs/ACCESS_FA.md`. Tests: `tests/access-*.test.ts`.

Contents: [1 Decisions](#1-decisions) · [2 Data](#2-data) · [3 Vocabulary](#3-vocabulary) ·
[4 Effective access](#4-effective-access) · [5 The subject](#5-the-subject) · [6 The read rule](#6-the-read-rule) ·
[7 SQL generation](#7-sql-generation) · [8 Writes](#8-writes) · [9 Field security](#9-field-security) ·
[10 Epochs, versions, caches](#10-epochs-versions-and-caches) · [11 Using it from other parts](#11-using-it-from-other-parts) ·
[12 Declaring tables and areas](#12-declaring-tables-and-areas) · [13 HTTP API](#13-http-api) ·
[14 Default role matrix](#14-default-role-matrix) · [15 Invariants](#15-invariants) · [16 Tests](#16-tests) ·
[17 Not built yet](#17-not-built-yet)

---

## 1. Decisions

The model follows the brief (B1b) and the spec draft §3, with these choices taken from the access research
(`docs/research/access.md`, "Final recommendation") and the feature catalogue (`docs/catalog/g1_platform.md`,
module *access*):

| Topic | Draft / brief | Built | Why |
| --- | --- | --- | --- |
| Row predicate | scope columns compared directly | same: one parameterised predicate over the record's own columns (`unit_id`, `domain_id`, `workspace_id`, the group field, the own user fields) | Exact and always fresh; no derived key column to re-key after a reorganisation and nothing to drift. The research's `acl_keys` (§3, §6 step 6) pays off for offline buckets shared between users and for vector-store partitions; both are later (§17). The key derivation can be added on top without changing the rule. |
| Restrictions | confidential rows | confidential rows **and** restricted groups and secure workspaces (catalogue ACC-028/030/031) | The research's deny-unless layer: AND-ed with grants and not passed by admin status. Restricted groups and secure workspaces are the cheapest, most-asked forms of it. |
| Grants | per area: read/create/write/delete scope, approve, admin | same; a `"*"` key for "every other area" | Modules register areas later; `tenant_admin` and `auditor` must cover them without edits. |
| Roles | tenant-editable, built-ins seeded | built-ins live in code, an organisation's row with the same key replaces one; «بازگشت به پیش‌فرض» deletes the row | No seeding migration, and improved defaults reach every organisation that has not changed a role. The diff against the default is exact. |
| Desk visibility | — | the «میز خدمت باز» / «نیاز به دانستن» preset (ACC-022) decides what the built-in agent roles read | The research's two tenant presets; MSP-style organisations want need-to-know. |
| Managers | department heads read their unit tree's requester-side records | also line managers (reportees to depth 2, ACC-009) | Same mechanism (requester-side visibility), cheap. |
| Delegation | out_of_office + delegate on the profile | the delegate works the absent member's *assigned* records only while they are away (ACC-061/063) | Work delegation, not standing access. |
| Legacy | — | members without ITSM roles keep the membership role's access in its six areas («حالت پیشین») | Existing organisations behave exactly as before until roles are assigned. |
| Platform admin | outside tenants, support sessions | same; a session is subject to secure workspaces and restricted groups and does not read the HR, security and AI-private field groups | "Restrictions outrank admin status" applies to the vendor too (research §1.3). |

## 2. Data

All access tables are ordinary engine tables (history, events, sync, the generic API `/r/<key>`), module `access`,
read in full by every member with a read grant in their area (`scope.public`: reference data the pickers and the
Windows app's own provider need), changed only with the write grants of their area.

| Key | Table | Area | Fields |
| --- | --- | --- | --- |
| `org_unit` | `sm_org_units` | org | name, code (unique), kind company \| division \| department \| team \| cost_center \| branch, parent_id, manager_id, location_id, is_domain, active, description, `path` and `depth` (system) |
| `location` | `sm_locations` | org | name, code, kind region \| country \| province \| city \| site \| building \| floor \| room, parent_id, timezone, address, active, `path`, `depth` |
| `workspace` | `sm_workspaces` | org | key (unique), name, icon, color, is_default (one per organisation), secure, active, description |
| `group` | `sm_groups` | org | name, types (assignment, approval, cab, oncall, general), parent_id, manager_id, email, skills, roles (inherited by members and leads), restricted, active, description, the base `workspace_id` |
| `group_member` | `sm_group_members` | org | group_id, user_id (unique pair), kind member \| lead \| observer, valid_from, valid_to |
| `member_profile` | `sm_member_profiles` | users | user_id (unique), name (copied), persona requester \| agent \| admin, roles (role keys), org_unit_id, location_id, manager_id, domain_unit_id, workspaces (explicit memberships), title, phone (`personal`), vip, skills, language, timezone, out_of_office, ooo_until, delegate_id |
| `role` | `sm_roles` | users | key (unique, immutable), name, description, persona, grants (JSON), field_groups, contains (role keys), workspaces member \| all, domains own \| all, active |

- Materialised paths are `/<root id>/…/<own id>/`; `org_unit` and `location` keep them by hook (a move rewrites the
  descendants' paths in the same transaction; parent cycles are refused; a node with live children is not deleted).
  Groups refuse cycles the same way (no path).
- Organisation settings: `sm_orgs.settings.access = { domain_separation: boolean, preset: "open" | "need_to_know" }`.
- `sm_access_state(org_id, version)` (local to each runtime): bumped by triggers on every insert, update and delete of
  units, groups, group members, workspaces, roles and profiles that can change access.
- The base columns `unit_id`, `domain_id` (anchors) and `workspace_id` of every record table: see §8.
- A table with `features.confidential` gets the fields `confidential` (bool) and `access_list` (users).

## 3. Vocabulary

- **Areas** (`@shared/access/areas.ts`): incident, request, catalog, knowledge, problem, sla, survey, csm, work
  («کارها», the generic `todo` table and saved views — the brief's `todo`), change, release, event, oncall, security,
  continuity, cmdb, asset, software, contract, procurement, vendor, service, risk, compliance, financial, project,
  workforce, hr, facilities, reports (the brief's `report`), and the platform areas org, users, settings,
  integrations, ai, flows, notifications, audit. `registerArea({ key, label, group })` adds one.
- **Scopes**, ordered: `none < own < group < unit < unit_tree < domain < all`, and cumulative — each reaches what
  the narrower ones reach — so the most permissive of a subject's grants never sees less than another.
- **Operations**: `read`, `write`, `delete` take a scope; `create`, `approve`, `admin` are flags. `fullGrant` makes a
  grant coherent: read ≥ write and delete; whoever creates reads at least their own.
- **Grants**: `Record<AreaKey | "*", Grant>`; `"*"` applies to every area a role does not name.
- **Roles** (`RoleDef`): key, name, description, persona, grants, field_groups, contains (cycle-checked), workspaces
  (`member` | `all`), domains (`own` | `all`), active. Containment is resolved transitively (`roleClosure`).
- **Field groups**: internal, financial, personal, security, hr, admin, ai_private.
- **Personas and presets**: a member's persona (requester, agent, admin) and «پیش‌تنظیم دسترسی» presets used when
  inviting (`PERSONA_PRESETS`: requester, agent, team_lead, service_desk_manager, hr_agent, facilities_agent,
  vendor_agent, auditor, tenant_admin).

## 4. Effective access

`composeEffective({ role, levels, explicit, catalog, support })` (pure, `@shared/access/model.ts`):

1. **Explicit roles** = the profile's roles ∪ the roles of every group the member belongs to as member or lead (not as
   observer), restricted to roles of the catalogue. Owners and the membership role «مدیر» (`admin`) also hold
   `tenant_admin`.
2. The effective grant of an area is the most permissive of the closure's roles, operation by operation; field
   groups are united; `workspacesAll` / `domainsAll` hold if any role says `all`.
3. **Legacy mode** — no explicit roles: in the six membership-role areas (settings, users, integrations, ai,
   reports, work) the membership role's levels apply exactly as before (view → read all; edit → + create and change
   all; full → + delete, approve, admin; per-area overrides included) with its field groups (viewers none, members
   internal + personal, owners/admins everything but hr and security); in every other area the member works as the
   role their membership maps to (owner/admin → tenant_admin, member → agent, viewer → auditor); all workspaces and
   domains.
4. **Support sessions** (a platform administrator who is not a member): «مشاهده» reads every area; «مشاهده و اصلاح» is
   `tenant_admin`; both keep the session's membership-area levels (members never changed, keys only seen), read every
   field group but hr, security and ai_private, and stay out of secure workspaces and restricted groups.
5. **The system** (`ctx.actor === "system"`: jobs, flows, rules) is allowed everything in its organisation.
6. A platform administrator who is neither a member nor in a support session gets nothing.

## 5. The subject

`prepareSubject(ctx, q)` builds, once per request, a `Subject`
(`@shared/access/evaluate.ts`): `eff`, `groups` (member, lead and observer memberships plus every group below a
group led), `writeGroups` (observers excluded), `ledGroups`, `unitId`, `unitTree` (the unit and its descendants),
`managedTree` (units managed and their descendants), `reportees` (people whose manager or manager's manager the
subject is), `delegators` (out-of-office members who named the subject their delegate, until `ooo_until`),
`domainSeparation`, `domainId` (the profile's `domain_unit_id`, else the nearest unit at or above the member's unit
flagged `is_domain`), `domainTree`, `workspaces` (explicit ∪ the workspaces of the subject's groups),
`secureWorkspaces`, `restrictedGroups`. Group memberships outside `valid_from`/`valid_to` do not count.

It is computed from an **organisation snapshot** (roles, units, groups, workspaces, profiles, memberships) cached per
process and revalidated **once per request** with one query: the organisation's access version and the member's
scope epoch. A subject is cached under (org, user, version, epoch, settings, membership role and overrides) and
recomputed when a membership's validity or an absence starts or ends (and at the latest after five minutes). Inside a
transaction nothing read is cached (it may roll back). The engine calls the provider's `prepare(ctx, q)` from
`orgSchema` — the first await of every engine entry point — with the request's transaction when there is one, so the
synchronous provider methods always find the subject; `subjectOf(ctx)` throws if a path forgets it.

## 6. The read rule

For a row `r` of table `T` (area `A`, scope columns `c` from `T.scope`, §12) and subject `s`, with
`g = grant(s, A)`:

```text
readable(s, T, r) =
  s is the system                                     → true
  r.org_id ≠ s.org                                    → false
  T is virtual (members)                              → true
  g.read = none                                       → false
  T.scope.public                                      → true
  ¬ domainOk ∨ ¬ confidentialOk                       → false
  own ∨ participant                                   → true
  scope(g.read) ∧ workspaceOk ∧ restrictedOk          → true
  requesterSide ∧ secureOk ∧ restrictedOk             → true
                                                      → false
```

| Term | Holds when |
| --- | --- |
| domainOk | separation is off, or a role reaches every domain, or `r.domain_id` is null or in `s.domainTree` |
| confidentialOk | `r.confidential` is not true, or the subject carries the table's confidential field group (default hr in area hr, else security), or `r.<group>` ∈ `s.groups`, or the subject is in an assignee or requester field, or on `r.access_list` |
| own | the subject is in an own field (`scope.own` ∪ `scope.requester`; users fields hold them), in `scope.watchers`, or an assignee field holds one of `s.delegators` |
| participant | a registered participant source holds (e.g. an approver of a pending approval) — SQL only, §7 |
| scope(group) | `r.<group>` ∈ `s.groups` (for writes: `s.writeGroups`) |
| scope(unit) | scope(group) ∨ `r.unit_id` = `s.unitId` |
| scope(unit_tree) | scope(group) ∨ `r.unit_id` ∈ `s.unitTree` |
| scope(domain) | scope(unit_tree) ∨ separation off ∨ `r.domain_id` null or in `s.domainTree` |
| scope(all) | always |
| workspaceOk | `r.workspace_id` null; or roles reach all workspaces and it is not a secure one the subject is outside; or it is one of `s.workspaces` |
| secureOk | `r.workspace_id` null or not a secure workspace the subject is outside |
| restrictedOk | `r.<group>` null or not a restricted group the subject is outside |
| requesterSide | the table has requester fields and `r.unit_id` ∈ `s.managedTree` (department heads) or a requester field holds one of `s.reportees` (line managers) |

Notes. Own records pass the workspace and restricted-group rules (a requester always sees their HR case; the requester
of a restricted group's ticket still sees it) but never the domain and confidentiality rules. Requester-side
visibility is read-only and passes the member-workspace rule (a department head sees the facilities requests of
their people) but not secure workspaces or restricted groups. Deleted rows are not filtered by the rule (the engine
adds `deleted_at is null` where it wants live rows; the sync pull needs the deleted ones).

`explainRow(s, T, r, extra)` returns every term as a layer `{ key, label, ok: true | false | null, detail }` (Persian)
with the decision and what made the row readable (`via`).

## 7. SQL generation

`readSql(s, T, alias, params)` and `writeSql(s, T, alias, params, "write" | "delete")`
(`src/server/access/predicate.ts`) compile the same terms into one predicate. Subject constants are parameters:
ids as `$n::uuid`, lists as `= any($n::uuid[])`, the subject for jsonb arrays of users as `? $n::text`, list members
of a jsonb users field as `?| $n::text[]`; null-safe (`coalesce(…, false)`, `(col is null or col <> all(…))`), so the
predicate never yields NULL. Constant terms fold (`all` → `true`, empty lists → `false`); parameters of folded terms
are dropped and the remaining placeholders renumbered, so callers can keep pushing their own.

```sql
-- an agent under need-to-know (one group, one workspace)
t.org_id = $1 and (coalesce(t.caller_id = $2::uuid, false) or coalesce(t.requested_for = $2::uuid, false)
  or coalesce(t.opened_by = $2::uuid, false) or coalesce(t.assigned_to = $2::uuid, false)
  or coalesce(t.watch_list ? $3::text, false)
  or (coalesce(t.assignment_group_id = any($4::uuid[]), false) and (t.workspace_id is null or t.workspace_id = any($5::uuid[]))))
```

Indexes (generated by the engine's DDL for every table with own fields or a group field): `(org_id, workspace_id)`,
`(org_id, unit_id)`, `(org_id, domain_id)` partial on live non-null rows, `(org_id, <own field>)` for every own user
field and GIN on users arrays (watchers), on top of `index: true` fields such as the task's group and assignee. On
10 000 tickets the page queries of a requester, a need-to-know agent and a department head use indexes only
(`tests/access-performance.test.ts`).

`registerParticipantSource({ name, sql(def, alias, params, userId) })` adds participants: the approvals service
registers `exists (select 1 from sm_approvals a where a.table_key = '<key>' and a.record_id = <alias>.id and …)`.
A source must push its own parameters and must not put `$` in string literals.

## 8. Writes

- **canCreate**: the area's `create` flag (the system always).
- **canWrite / canDelete** (`writeMode(s, T, r, op)`): `domainOk ∧ confidentialOk ∧ (assignee or delegate of the
  assignee ∨ (scope(write | delete, using writeGroups) ∧ workspaceOk ∧ restrictedOk) ∨ requester)`. The result is
  `full`, or `requester` when the subject reaches the row only through a requester field of a table that declares
  `scope.requesterWritable` (requesters never delete such rows), or null.
- **writableFields**: in `requester` mode only `scope.requesterWritable` (task: description, urgency, watch_list);
  otherwise every visible field. A change outside it is 403 `forbidden_field` «اجازهٔ تغییر «…» را ندارید» (the
  state field goes through transitions). Requesters add public comments and attachments to readable records (the
  engine's rule); internal notes need the `internal` field group.
- **canTransition**: a write mode is required; in `requester` mode only `scope.requesterTransitions` (task: confirm or
  reopen a resolved record, cancel a new one); a transition's `roles: { area, level, roles? }` means view → read in
  `area`, edit → full write mode and a write scope in `area`, full → the `approve` flag of `area`, and `roles` →
  one of these role keys.
- **Hooks** (`src/server/access/hooks.ts`, same transaction):
  - *Anchors*: on create, and whenever a requester field changes, `unit_id` = the unit of the first non-empty
    requester field's member (`scope.requester`, task: requested_for, caller_id, opened_by) and `domain_id` = their
    domain; a profile's own anchors are its unit and domain. Callers never set them (system fields); the engine
    persists what the hook sets.
  - *Assignment constraint*: a member whose roles do not reach every workspace assigns only to groups of their
    workspaces (or groups without one).
  - *Create on behalf*: a member who is only a requester in the area (write scope none or own) puts only themselves,
    their reportees or people of the units they manage in requester fields.
  - *Roles*: role keys must exist; a role definition must be valid (`roleProblem`: key, areas, scopes, field groups,
    contained roles exist, no containment loop); nobody but an owner (or the system) grants roles (to a profile or a
    group) or defines a role whose closure exceeds their own effective access (`exceeds`), changes their own roles,
    or changes the roles of a member with more access than they have; a role's key never changes.
  - *Trees*: paths, cycles, children (§2). *Workspaces*: one default.
- **Sync pushes** are judged by the same provider on the cloud (`canCreate`, `canWrite`/`canDelete` on the stored row,
  hidden and unwritable fields keep the cloud's values); hooks do not run again there.

## 9. Field security

A field with `group` is visible only to subjects carrying the group (`visibleFields`), and writable only by them.
Hidden fields are stripped from records, lists, exports and display values, refused in filters, sorts and group-bys
(400 with a Persian reason), and left out of the history; the journal's internal entries need `internal`. The system
sees everything; a support session sees every group but hr, security and ai_private. Fields without a group follow
row access.

## 10. Epochs, versions and caches

- **Access version** (`sm_access_state`, trigger): every relevant change to the access tables, whichever path wrote
  it (API, import, sync push on the cloud, sync pull on the desktop), moves it; subjects and snapshots revalidate
  against it on the next request of every instance — revocation is immediate.
- **Scope epochs** (`sm_scope_epochs`, engine): moved by trigger for the member of a group membership, for the member,
  their old/new manager and delegate on a profile change, and for every member on a change to roles, groups, units or
  workspaces; by the engine's own trigger on a membership's role, access or activation; and for everyone when the
  access settings change. A Windows app whose epoch is behind re-reads everything and tombstones what left its scope.
- Records that leave a member's scope through their own change (reassigned, re-anchored) are sent as tombstones by
  the next pull (`tests/access-sync.test.ts`).

## 11. Using it from other parts

The provider is installed for every server (`installAccessModel()` in `src/server/routes/modules.ts`); nothing reads
engine tables around it.

- **API routes and services**: use the engine (`list`, `get`, `aggregate`, `exportRows`, `create`, `update`, …) with
  the request's `ctx`. Own SQL over engine tables starts from `readable(ctx, def, alias, params, env)` and strips
  fields with `access().visibleFields(ctx, def)`.
- **Reports and dashboards**: `aggregate` (grouping by hidden fields refused); drill-downs list through `list`.
- **Global search**: per table `list(ctx, key, { q })`, or own SQL starting from `readable`; candidates from an index
  re-checked with `readableIds(ctx, table, ids)`.
- **Notifications**: `readersOf(cfg, orgId, table, id, userIds)` keeps only recipients who may read the record;
  `memberCtx(cfg, orgId, userId)` gives a recipient's context to render the record under their field visibility.
- **AI layer**: the assistant acts as the user — its tools call the engine with the user's `ctx` (never `systemCtx`).
  Retrieval binds early (the candidate query includes `readable(...)` of the user) and late (`readableIds` on the
  final hits before anything reaches the prompt); chunks carry only fields in `visibleFields` of the user, and fields
  of the `ai_private` group never reach a prompt. Autonomous agents act through a member context of their own
  principal (later). Counts are never taken from pre-filtered candidates.
- **Sync**: automatic (pulls filtered by `readWhere`, epochs and tombstones above).
- **Access checks in other modules' UIs**: `GET /access/me` (effective grants per area, field groups, groups, workspaces).

## 12. Declaring tables and areas

A module names its area (`registerArea` for a new one) and the scope columns in `TableDef.scope`:

| Key | Meaning | Default |
| --- | --- | --- |
| `own` | user fields that make a record the subject's own | task: caller_id, requested_for, opened_by, assigned_to |
| `requester` | requester-side own fields, in priority order: whose record it is (anchors, managers' visibility, create on behalf) | `own` minus `assigned_to` (task: requested_for, caller_id, opened_by) |
| `watchers` | users field of watchers | task: watch_list |
| `group` | the assignment group field | task: assignment_group_id |
| `unit`, `domain`, `workspace` | anchor columns | unit_id, domain_id, workspace_id |
| `requesterWritable` | fields a requester-only subject may change | task: description, urgency, watch_list |
| `requesterTransitions` | `{ from?, to }[]` such a subject may take | task: resolved → closed, resolved → in_progress, new → canceled |
| `confidentialGroup` | field group whose holders read confidential rows | hr in area hr, else security |
| `public` | every subject with a read grant in the area reads all rows (reference data) | false |

`features.confidential` adds the `confidential` and `access_list` fields. Field groups go on fields (`group`).
A transition limited to approvers: `roles: { area: "change", level: "full" }`; to named roles:
`roles: { area: "change", level: "view", roles: ["change_manager"] }`.

## 13. HTTP API

Under `/api/o/:org/access` (signed-in member or support session):

| Method and path | Who | Body / answer |
| --- | --- | --- |
| `GET /me` | everyone | the caller's effective access (`AccessSummary`) |
| `GET /roles` | users read all | `{ roles: RoleView[] (builtin, modified, diff, holders, version), preset, presets }` |
| `PUT /roles/:key` | users admin | `{ name, description, persona, grants, field_groups, contains, workspaces, domains, active, version }` → `{ role }` |
| `POST /roles/:key/reset` | users admin | back to the built-in default |
| `DELETE /roles/:key` | users admin | a custom role nobody holds or contains |
| `GET /settings`, `PUT /settings` | read all / admin | `{ domain_separation, preset }` |
| `GET /members` | users read all | members with persona, roles, unit, group count, legacy flag |
| `GET /members/:userId` | users read all | profile, groups, role sources, effective access |
| `PUT /members/:userId` | users write | profile fields (+ `version`) |
| `POST /members/:userId/preset` | users write | `{ preset }` |
| `POST /groups/:id/members` | org create + write on the group | `{ user_ids, kind }` → `{ added, updated }` |
| `POST /check` | users admin | `{ user_id, table, record_id? }` → grant, roles, hidden fields, and for a record the layered explanation and the SQL verdict (the caller must be able to read the record) |

Units, locations, workspaces, groups, memberships, profiles and roles are also served by `/r/<key>`.

## 14. Default role matrix

Generated from `builtinRoles("open")` with containment resolved. A cell is the read scope, `+C` create, `W:` write,
`D:` delete, `Ap` approve, `Ad` admin; `grp` group, `tree` unit tree, `–` nothing. Under «نیاز به دانستن» every `all`
read of `agent`, `team_lead` and `security_analyst` in operational areas (incident, request, problem, change, work,
release, event) becomes `grp`.

| role | incident | request | problem | change | release | knowledge | catalog | cmdb | asset | hr | facilities | security | work | reports | org | users | settings | field groups | ws / dom |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `requester` | own+C W:own | own+C W:own | – | – | – | all | all | – | – | own+C W:own | own+C W:own | – | own+C W:own | – | all | own | – | – | member / own |
| `agent` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:own | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `team_lead` | all+C W:grp Ap | all+C W:grp Ap | all+C W:grp Ap | all+C W:grp Ap | all | all+C W:own | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp Ap | all | all+C W:grp D:grp | all | – | internal, personal | member / own |
| `service_desk_manager` | all+C W:all D:all Ap | all+C W:all D:all Ap | all+C W:all D:all Ap | all+C W:grp Ap | all | all+C W:all Ap | all+C W:all Ad | all | all | own+C W:own | own+C W:own | – | all+C W:all D:all Ap | all+C W:all | all+C W:all D:grp | all | – | financial, internal, personal | member / own |
| `incident_manager` | all+C W:all Ap | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:own | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `problem_manager` | all+C W:grp | all+C W:grp | all+C W:all Ap | all+C W:grp | all | all+C W:all | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `change_manager` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:all Ap | all+C W:grp | all+C W:own | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `cab_member` | own+C W:own | own+C W:own | – | all Ap | all | all | all | – | – | own+C W:own | own+C W:own | – | own+C W:own | – | all | own | – | internal | member / own |
| `release_manager` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:all Ap | all+C W:own | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `asset_manager` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:own | all | all+C W:grp | all+C W:all D:all Ap | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | financial, internal, personal | member / own |
| `configuration_manager` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:own | all | all+C W:all D:all Ad | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `knowledge_manager` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:all D:all Ap Ad | all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `service_owner` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:own | all+C W:all | all | all | own+C W:own | own+C W:own | – | all+C W:grp | all | all | all | – | internal, personal | member / own |
| `security_analyst` | all+C W:grp | all+C W:grp | all+C W:grp | all+C W:grp | all | all+C W:own | all | all | all | own+C W:own | own+C W:own | grp+C W:grp Ap | all+C W:grp | all | all | all | – | internal, personal, security | member / own |
| `hr_agent` | own+C W:own | own+C W:own | – | – | – | all+C W:own | all | – | – | grp+C W:grp | own+C W:own | – | grp+C W:grp | – | all | all | – | hr, internal, personal | member / own |
| `facilities_agent` | own+C W:own | own+C W:own | – | – | – | all+C W:own | all | – | all | own+C W:own | grp+C W:grp | – | grp+C W:grp | – | all | all | – | internal, personal | member / own |
| `vendor_agent` | grp W:grp | grp W:grp | grp W:grp | grp W:grp | – | – | – | – | – | – | – | – | grp W:grp | – | – | – | – | – | member / own |
| `auditor` | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | all | admin, financial, internal, personal | all / all |
| `tenant_admin` | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | all+C W:all D:all Ap Ad | admin, ai_private, financial, internal, personal | all / all |

The `public` reference tables (units, locations, workspaces, groups and memberships in area `org`; profiles and roles
in area `users`) are read in full by every subject with any read grant in their area — every built-in role but
`vendor_agent`, which as an external role sees no directory — and changed only with write grants.

## 15. Invariants

1. One decision point: every read of an engine table goes through `readWhere`/`readable`; every write through the
   provider's write methods; no module reads engine tables with raw SQL around them.
2. Default deny: an area a subject's roles do not name gives nothing; a member without a membership gets nothing.
3. Tenant isolation is part of every predicate (`alias.org_id = $n`); RLS is on for every `sm_*` table.
4. SQL form == JS form for read, write and delete on any organisation (property tests).
5. Restrictions (domains, confidential rows, secure workspaces, restricted groups) are AND-ed with grants and are
   not passed by `workspaces: all`, `tenant_admin` or support sessions; only membership, the record's own people,
   the access list or the named field group pass them.
6. Nobody grants or defines access above their own, or changes their own roles (owners excepted).
7. Anchors (`unit_id`, `domain_id`) are derived by the server, never taken from callers.
8. What a member may read changes ⇒ their scope epoch moves (trigger) and the access version moves (trigger).
9. An unreadable record does not exist for the caller (404); an unreadable table is 403 for lists.
10. The access checker explains only records its user (an access administrator) can read.

## 16. Tests

`access-model` (pure: scopes, grants, closure, cycles, composition, built-in catalogue and matrix, presets, diffs,
escalation), `access-parity` (random organisations × subjects × presets × separation × support: SQL == JS for read,
write, delete on two tables), `access-api` (every built-in role end to end; workspaces, secure workspaces, restricted
groups, confidential rows, domains, presets, delegation, field stripping on records, lists, meta, filters, aggregates,
exports, history, journal, display values; requester whitelist, transitions, create on behalf; scope epochs; the role
catalogue (diff, reset, cycles, escalation); the access checker; org trees and anchors; support sessions),
`access-sync` (filtered pulls, hidden fields, tombstones, epoch reset, push judging), `access-performance` (EXPLAIN on
10 000 tickets: index scans only).

## 17. Not built yet

From the catalogue's P0/P1 list, deliberately later (each fits the model above):

- Access keys (`acl_keys`) for shared offline buckets and vector-store partitions; keyed working sets for broad
  scopes on the desktop.
- Role assignment in a context (a role pinned to a unit subtree, a company, a service) with validity and provenance
  (ACC-018); today roles are tenant-wide and group memberships carry validity.
- Security levels, data classification ceilings, the external-user fence (ACC-003/029/032), shares and hand-off grace
  (ACC-035/036), audiences (ACC-040), separation-of-duties rules (ACC-041, with the approvals service), option rules.
- Just-in-time elevation, view-as, break-glass, the policy simulator and versioned publishing (ACC-064/065/066/091),
  access reviews, the privileged-action log beyond the audit entries written today.
- Identity: SSO, MFA, SCIM, joiner–mover–leaver automation (platform workstream).
- Process separation per domain (configuration override chains) and delegated domain administration.
