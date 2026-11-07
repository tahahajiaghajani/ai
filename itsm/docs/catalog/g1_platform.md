# Platform, administration, integration and access control

Group **g1_platform** of the consolidated ITSM feature catalog. It covers four modules: `platform` (the metadata-driven record engine and shared services), `admin` (administration and the configuration lifecycle), `integration` (APIs, connectors, channels, AI-model and MCP interoperability) and `access` (identity, org structure, permissions, field security, domain separation, privileged access and AI enforcement). The access module follows the final recommendation of the access research: grants are capability × scope × condition, restrictions outrank grants and admin status, every secured record carries access keys, and one policy is compiled into a SQL predicate, access keys and an in-memory evaluator.

**Conventions**
- IDs: `PLT-`, `ADM-`, `INT-`, `ACC-`. Heading = `ID English name · Persian name`.
- Tier: **P0** = must have for an enterprise ITSM v1; **P1** = strong differentiator to build next; **P2** = later or optional.
- AI: **yes** when the feature contains a model-backed capability (generative, ML or agentic). The `ai` module owns skills, agents and the AI governance register; this group owns the plumbing and the guardrails.
- Sources name the tools and frameworks that have the capability; "our design" marks capabilities that no studied tool offers.
- Architecture terms follow the engineering spec draft: `TableDef` registry, record service, access provider, jobs/outbox, sync, physical tables `sm_*`, `org_id` = tenant id, `unit_id` = org unit, Hono API, two runtimes (web on Supabase Postgres, Windows on Electron + PGlite).
- Ownership boundaries: SLA definitions (slm), catalog forms (request), knowledge bases (knowledge), CMDB reconciliation and discovery (cmdb/itam), event correlation (event), AI skills and agents (ai), report builder (analytics). This group provides the engine services those modules use.

## Module: platform — سکوی پایه و موتور رکورد

### Features

#### PLT-001 Metadata-driven table registry · رجیستری جدول‌ها بر پایهٔ فراداده
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, Ivanti, iTop, ManageEngine SDP, Freshservice, JSM
- **Description:** Every object users work with (tickets, CIs, assets, articles, and also configuration such as SLA definitions, roles and flows) is a record of a table described once as metadata: key, physical table, labels (fa/en), icon, module and area, display field, fields, state model, scope fields, feature flags (journal, attachments, watchers, history, SLA, approvals, links, RAG, sync, tags, survey, confidential, kanban group-by, calendar fields), form and list defaults and the fields that form the AI document. The server generates DDL, validation, storage, audit, security, sync and indexing from it; the UI renders lists, forms, boards and calendars from the same definition.
- **Implementation:** `TableDef` in `src/shared/tables/*` (no server imports, shared with the UI); `ddlFor(def)` emits idempotent DDL, indexes, the sync trigger and RLS; `reconcileSchema` re-applies additive DDL when its hash changes; `/meta/tables` returns definitions filtered to what the caller can read, merged with tenant customisations.

#### PLT-002 Task supertable · ابرجدول «کار» (پایهٔ مشترک رکوردهای کاری)
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, BMC Helix, ITIL 4
- **Description:** `extends: "task"` gives incidents, problems, changes, request items, tasks, cases, PIRs, reviews and custom work types the shared fields and behaviours: number, short description, description, state, priority/impact/urgency, category, channel, caller / requested for / opened by, assignment group and assignee, service, offering, CI, location, due date, resolved/closed by and at, close code and notes, parent, watch list, approval aggregate, reassignment and reopen counts, time worked, first response, active flag and earliest SLA due. ITIL's ownership rule (a person owns the record at any time after triage) is a configurable guard and every ownership transfer is logged.
- **Implementation:** `TASK_FIELDS` merged at registry build time; SLA, approvals, assignment, journal, watchers and audit are implemented once for all task tables; owner-not-null is a transition `requires` rule; extra columns per type or `custom jsonb`.

#### PLT-003 Rich field types · انواع غنی فیلد
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, Freshservice, JSM, BMC Helix
- **Description:** string, text, markdown, integer, decimal, money (multi-currency with Rial/Toman display and a rate snapshot), percent, boolean, date, datetime (UTC storage, Jalali display), duration, choice, multi-choice, reference(s), user(s), group, email, URL, phone (Iranian mobile normalisation), IP address, JSON, conditions, tags, colour, rating, secret (write-only, encrypted), national ID (checksum-validated, hash-match lookup) and postal code. Each type validates input, normalises Persian/Arabic digits and returns Persian error messages that name the field; each field can carry a security field class.
- **Implementation:** type map to Postgres types (spec §1.2); `values.ts` coercion; money as `numeric` with decimal.js; the national-ID type writes an HMAC column for exact lookups (ACC-047).

#### PLT-004 Tenant custom fields · فیلدهای سفارشی سازمان
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, ManageEngine SDP, ServiceNow, JSM, GLPI
- **Description:** Tenant admins add fields to any table without code: type, label per locale, help text, default, required on submit or on resolve, visible/editable for requesters, field class, searchable and filterable flags, list default, section placement and workspace/domain applicability. Values are validated like engine fields; definitions are versioned and travel in configuration packages.
- **Implementation:** `custom_field` table; values in the record's `custom jsonb` with GIN and expression indexes for filterable fields; merged into `/meta/tables`; renaming a label never changes the stable `name`.

#### PLT-005 Custom record types (no-code tables) · نوع رکورد سفارشی بدون کد
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice, ManageEngine SDP, ServiceNow, Ivanti, BMC Helix, GLPI
- **Description:** Admins define new record types (a vehicle request, a cost-centre lookup, an approver matrix) with fields, numbering prefix, optional task behaviour (states, SLA, assignment, approvals), forms, lists, scope fields and features. Custom types automatically get APIs, search, audit, sync, RAG indexing and permissions, and can be read from flows, catalog lookups and approval rules.
- **Implementation:** `custom_table` metadata compiled to a `TableDef` at runtime; physical table `sm_x_<key>` created by the reconciler; an area key is registered for grants; deletion archives the type.

#### PLT-006 Choice lists and dependent choices · فهرست‌های انتخابی و وابسته
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, ManageEngine SDP, BMC Helix
- **Description:** Tenant-editable value lists with order, colour, icon and per-locale labels; inactive values stay valid on old records; dependent lists filtered by a parent value up to three levels; lists shared across tables or bound to one field, with workspace and domain overrides.
- **Implementation:** `choice` table keyed by `list_key`; client cache per epoch; server validates against active and historical values; option rules (ACC-038) narrow choices further by context.

#### PLT-007 Reference fields and dot-walking · فیلدهای ارجاعی و پیمایش نقطه‌ای
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, ManageEngine SDP, Freshservice
- **Description:** References to records of any table with picker filters (conditions that may use the current form's values), display values on every read, one- or two-level dot-walking in filters, lists, rules and templates (`caller_id.unit_id.manager_id`), hover previews and reverse related lists. Pickers only offer records the user can read.
- **Implementation:** batched display-value resolution (no N+1); dot-walks compiled to correlated subqueries; referential checks within the same org; deleted targets render as «حذف‌شده».

#### PLT-008 Universal condition language · زبان یکپارچهٔ شرط
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, HaloITSM, Znuny, iTop
- **Description:** One JSON AST (`and`/`or`/`not` over field-operator-value) for list filters, queues, business rules, UI policies, SLA start/pause/stop, notification and assignment rules, audiences, grant conditions, report filters and AI tools. Operators cover equality and sets, ranges, text matching, empty checks, relative dates in Jalali weeks/months/quarters/years, `is_me`, `in_my_groups`, `in_my_unit(_tree)` and, in rules, `changed`/`changes_to`/`changes_from`. The visual builder supports grouped AND/OR, renders the condition as a Persian sentence and offers an advanced text mode.
- **Implementation:** `evaluate(cond,row,env)` and `toSql(cond,def,alias,params,env)` with parity tests; validation against field types; operator rights per field come from inference control (ACC-045).

#### PLT-009 State models and guarded transitions · مدل وضعیت با گذارهای کنترل‌شده
- **Tier:** P0 · **AI:** no · **Sources:** JSM, ServiceNow, GLPI, iTop, RT, ManageEngine SDP, ISO/IEC 20000-1
- **Description:** States per table with a category (new, active, waiting, resolved, closed, canceled), colour and order. Transitions declare labels, source states, required fields, required rights, guard hooks, confirmation and mandatory-comment flags, and category side effects (resolved/closed stamps, `active=false`, reopen count, SLA pause/stop). The UI shows only allowed transition buttons and the server enforces them on every path: UI, API, import, sync, flows and AI proposals.
- **Implementation:** `StateModel` in the `TableDef` plus tenant overrides per workspace, domain and record model; `records.transition`; transition rights come from ACC-020.

#### PLT-010 Versioned record models and process packs · مدل‌های فرایندی نسخه‌دار و بسته‌های فرایند
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, ServiceNow, Freshservice, FitSM, USM, MOF, IT4IT
- **Description:** A record model bundles, for one record type, the classification criteria, the state-model variant, fields required per state, approvals, task templates, SLA definitions, communication templates, automations and a review cadence (incident, major-incident, request, standard/normal/emergency change, release models). Models are versioned (draft → published → retired) and in-flight records keep the version they started with. Process packs ship complete configurations (ITIL 4, FitSM's 14 processes, USM's 5 processes and 8 workflows) as importable content.
- **Implementation:** `record_model` with `version`; records store `model_id` and `model_version`; packs are content packages (ADM-005, ADM-009).

#### PLT-011 Numbering service · سرویس شماره‌گذاری
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, BMC Helix, Freshservice
- **Description:** Per tenant and table: prefix plus zero-padded counter (INC0001234), gapless under concurrency; optional prefixes per workspace or domain and an optional Jalali-year segment (INC-1405-000123); numbers display in Persian or Latin digits per user and search accepts both; records created offline get a provisional number that is renumbered if it clashes on sync.
- **Implementation:** counter row per (org, table[, scope]) locked in the write transaction; renumber-on-push like the forked numbered-aggregate mechanism; unique `(org_id, number)`.

#### PLT-012 Configuration version pinning · ثبت نسخهٔ پیکربندی اعمال‌شده
- **Tier:** P0 · **AI:** no · **Sources:** ISO/IEC 20000-1, ITIL 4, Freshservice, ServiceNow, JSM
- **Description:** When versioned configuration is applied to a record, the record keeps the version that applied: priority matrix, SLA definition, flow, record model, approval rule, the KB article version used in a resolution, and the policy version used in an access decision. Auditors can answer "which rule applied then?", and edits never change work already in flight.
- **Implementation:** every configuration table is versioned (ADM-007); writers store `<config>_version` columns or rows in `config_usage(record_ref, config_ref, version, at)`.

#### PLT-013 Module extension points · نقاط توسعهٔ ماژول‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, ManageEngine SDP
- **Description:** Modules extend the engine without forking it: per-table hooks (`beforeWrite`, `afterWrite`, `validateTransition`), record events (`record.created/updated/state_changed/assigned/commented`, `sla_warning/breach`, `approval_requested/decided`) consumed by subscribers, background job handlers, UI slots on record pages, AI tool registration and area keys for permissions.
- **Implementation:** `registerHooks`, `onRecordEvent`, `registerJobHandler` and a UI slot registry; hooks run inside the write transaction; external side effects only through outbox jobs, never inside a transaction.

#### PLT-014 Layered customisation with soft locks · سفارشی‌سازی لایه‌ای با قفل نرم
- **Tier:** P1 · **AI:** no · **Sources:** iTop, Ivanti, OpenText SMAX, ServiceNow
- **Description:** Configuration is layered: vendor base → content packs and extensions → tenant delta → workspace/domain override. Each tenant change records the property it overrides, so a platform upgrade re-applies the base and keeps tenant edits; vendor-locked properties cannot be edited; "clone record type" copies fields, layouts and rules into a new custom type without locks and forces roles and flows to be bound again by hand.
- **Implementation:** configuration stored as base plus per-property delta patches; effective configuration = merge(base, packs, tenant, domain); three-way merge in the upgrade center (ADM-014).

#### PLT-015 Generic list views · نمای فهرست عمومی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, HaloITSM
- **Description:** Column chooser, multi-sort, condition builder and quick filters (including grouped filters such as "assigned to me OR new and unassigned"), group-by with counts, saved personal and shared views (queues), inline edit, multi-select bulk actions, row colouring by rule, density, export, keyset paging with virtualised rows for 10k+ records, exact counts for small results and labelled estimates above a threshold, "assign to me" and a quick-view drawer. Each user's list state is stored on the server and roams between web and desktop.
- **Implementation:** `view` table; list API with `fields`, `filter`, `sort` and cursor; counts through the compiled access predicate; virtualised RTL table component.

#### PLT-016 Generic forms and persona layouts · فرم عمومی و چیدمان هر نقش
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, ManageEngine SDP, JSM, BMC Helix
- **Description:** Section and tab layouts per table, persona (requester, agent, manager), workspace/domain and record model; field spans and help text; read-only/hidden states driven by state and rights; a header with number, state breadcrumb, SLA chips and actions; related lists and links; an embedded activity stream; a focused view that hides empty fields; draft autosave; a single-column layout on phones.
- **Implementation:** form metadata in the `TableDef` plus tenant `form_layout` overrides; the server returns `meta` (canWrite, read-only fields, allowed transitions, SLA timers) with every record.

#### PLT-017 Kanban boards · تابلوی کانبان
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, ManageEngine SDP, Ivanti, ITIL 4
- **Description:** Board view of any table grouped by a field (state, assignee, priority or custom), with swimlanes, card fields and colours, WIP limits per column, quick filters and drag-to-transition that respects transition rules and opens required-field dialogs; every drag has a keyboard and menu alternative.
- **Implementation:** `features.kanban` plus saved board views; a drop calls the `transition` or `update` API; RTL column order.

#### PLT-018 Calendar and timeline views · نمای تقویم و خط زمانی
- **Tier:** P0 · **AI:** no · **Sources:** JSM, Freshservice, ManageEngine SDP, ServiceNow
- **Description:** Day, week and month calendars of any table with date fields, Jalali by default with a Gregorian toggle, Iranian holidays shaded, maintenance and blackout windows overlaid, and drag-to-reschedule with a keyboard alternative; a timeline (Gantt-style) view for records with durations and link dependencies; each saved calendar view can publish an iCal feed (INT-022).
- **Implementation:** `features.calendar {start, end}`; Jalali grid helpers in `src/shared`; overlap and conflict badges evaluated with conditions.

#### PLT-019 Unified work backlog («کارهای من») · صف کار یکپارچه
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, Freshservice, JSM, ServiceNow
- **Description:** One cross-type list per person and per team that combines incidents, requests, tasks, changes, problems, approvals and reviews, ordered by a team rank that is separate from priority, with WIP limits, effort estimates, an SLA-risk indicator, ageing, "pull next" and a reason why each item is listed.
- **Implementation:** union view over task tables through the access predicate; per-team fractional rank; materialised for large tenants.

#### PLT-020 App shell, navigation and record tabs · پوستهٔ برنامه و ناوبری
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Zendesk
- **Description:** `AppShell` with five menu groups, favourites, recent history, a workspace switcher, global search, the notification bell, the AI entry point and the user menu; every page starts with `PageHeader` (title, section tabs, at most two main actions); records open as tabs inside the agent workspace with drafts and unread markers per tab; every record and view has a deep link.
- **Implementation:** forked shell; route registry per module; tab state on the client with server-side drafts.

#### PLT-021 Command palette and keyboard registry · پالت فرمان و میان‌برها
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, JSM, Zendesk
- **Description:** A Ctrl+K palette that mixes navigation, record search by number or text, actions on the current record (assign, transition, comment) and AI prompts («خلاصه کن»، «پاسخ پیشنهادی بنویس»); a central shortcut registry with page, record and global scopes, chords, conflict detection, user remapping and a help modal (Ctrl+/).
- **Implementation:** registry in `src/ui`; actions come from the record `meta`, so only permitted actions appear; AI prompts invoke AI skills with the record context.

#### PLT-022 Personal preferences · ترجیحات شخصی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, ManageEngine SDP, JSM
- **Description:** Language, calendar (Jalali or Gregorian), digit style, time zone, date-time format, density, theme, start page, notification preferences, shortcuts and accessibility options (reduced motion, contrast, focus ring, font size), stored per user and roaming across web, desktop and phone.
- **Implementation:** `user_pref` (synced); tenant defaults; applied by the formatting helpers (`formatJalali`, `faNum`).

#### PLT-023 RTL-native UI and bidi handling · رابط راست‌به‌چپ بومی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, our design (no leader is fully RTL)
- **Description:** Every screen is designed right-to-left first: logical CSS properties; direction-aware icons, charts, calendars, progress bars and boards; LTR islands for IDs, code, e-mails, URLs, IPs and Latin product names; editors that keep mixed Persian/English text readable; Persian typography, digits and punctuation.
- **Implementation:** design tokens and logical Tailwind utilities; a lint rule against physical left/right; RTL visual regression tests.

#### PLT-024 Multi-language UI and translatable content · رابط چندزبانه و محتوای ترجمه‌پذیر
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, ITIL 4
- **Description:** Persian is the default; English and further locales can be enabled per tenant. UI strings, choice and field labels, catalog items, KB articles, notification templates and portal content are translatable per locale with fallback to the primary language; each user picks a language; records keep the language they were written in.
- **Implementation:** message catalogs for the UI; `translation` table for fields flagged `translated`; locale-aware formatting; translation workflow and machine translation in ADM-020.

#### PLT-025 Accessibility (WCAG 2.2 AA) · دسترس‌پذیری
- **Tier:** P0 · **AI:** no · **Sources:** WCAG 2.2, EN 301 549, ServiceNow, ManageEngine SDP
- **Description:** Full keyboard operation; focus never hidden by sticky headers (2.4.11); 24×24 px targets (2.5.8); click alternatives for every drag (2.5.7); consistent help (3.2.6); no redundant entry (3.3.7); accessible authentication that allows paste and password managers (3.3.8); status messages announced (SLA thresholds only when crossed); patterns as well as colour in charts; reduced motion; forced colours respected; 400% reflow on key forms; tested in RTL with Persian screen-reader output.
- **Implementation:** axe checks in CI, manual NVDA runs in Persian per release, an accessibility conformance report per release.

#### PLT-026 Theming: dark mode, density and design tokens · تم، حالت تیره و تراکم
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, ManageEngine SDP
- **Description:** Light, dark and system themes; comfortable, default and compact densities; every colour comes from tokens, so tenant branding (ADM-019) and stage colours apply consistently; charts are checked for contrast in both themes.
- **Implementation:** the fork's token system; `data-theme` on `<html>`; a lint rule forbids raw hex values.

#### PLT-027 Print and PDF layouts · قالب‌های چاپ و PDF
- **Tier:** P1 · **AI:** no · **Sources:** JSM, HaloITSM, ManageEngine SDP, our fork (desktop print/PDF)
- **Description:** Print/PDF templates per table (record summary, change plan, approval certificate with signatures, asset hand-over form, KB article) with embedded Persian fonts, Jalali dates, letterhead and the number/date block of an official letter; an immutable PDF snapshot of submitted forms attached to the record; batch printing from lists.
- **Implementation:** HTML templates rendered on the server or with Electron `printToPDF` on desktop; the same placeholders as notification templates; snapshots stored as attachments with their hash.

#### PLT-028 Journal: comments, work notes and system entries · دفتر یادداشت رکورد
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, BMC Helix, ITIL 4
- **Description:** Append-only entries per record with kind (comment, work note, system, e-mail in/out, approval, AI, chat), visibility (public or internal), author and on-behalf-of, mentions and attachments; a short edit window with history; a composer with an explicit public/internal switch and a warning when a public reply looks internal; "action started/completed" times for entries written after the fact, as ITIL's concurrent-records rule requires.
- **Implementation:** `journal` table; internal entries belong to the `internal` field class (ACC-044); entries copy the parent's access keys, and internal notes drop requester and external keys.

#### PLT-029 Field history and unified activity stream · تاریخچهٔ فیلدها و جریان فعالیت
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, ManageEngine SDP, ISO/IEC 20000-1, ITIL 4
- **Description:** Field-level history for audited fields: old and new value, actor, actor kind (user, automation, integration, AI agent, support), channel (UI, API, import, sync, flow, AI), reason and time. The activity stream merges journal entries, field changes, e-mails, approvals, SLA events, flow steps and AI actions into one filterable, time-ordered feed; changes to fields the viewer cannot read show only «فیلد تغییر کرد».
- **Implementation:** `history` written by the record service in the same transaction; the feed is a merged query; reassignment count, time in state and similar metrics are derived from history rather than from mutable counters alone.

#### PLT-030 Tamper-evident audit chain · زنجیرهٔ ممیزی ضددستکاری
- **Tier:** P1 · **AI:** no · **Sources:** ISO/IEC 27001, ISO/IEC 20000-1, EU AI Act, SOC 2, COBIT 2019
- **Description:** History and privileged logs are append-only and hash-chained per table; a daily Merkle root per table is exported to WORM storage and included in evidence packs; a verifier tells auditors whether any row was altered or removed. Application roles have no UPDATE or DELETE rights on history.
- **Implementation:** `history.prev_hash/hash = SHA-256(prev_hash || canonical(diff))`; `audit_anchor` rows from a nightly job; a verification endpoint; history rows created offline are chained by the server on upload.

#### PLT-031 Attachments · پیوست‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, JSM, ManageEngine SDP, GLPI
- **Description:** Upload by drag-and-drop, paste or e-mail; per-org dedupe by SHA-256; size limits and blocked file types per tenant; a malware-scan hook with quarantine; image and PDF preview; Persian file names preserved; attachments belong to a record or journal entry and are served only when that record is readable (ACC-048); the desktop downloads content lazily.
- **Implementation:** `attachment` and `blob` (bytea or object storage); short-lived signed download URLs; `scan_status` column; thumbnails generated by jobs.

#### PLT-032 Typed record links · پیوندهای نوع‌دار بین رکوردها
- **Tier:** P0 · **AI:** no · **Sources:** JSM, ServiceNow, BMC Helix, ITIL 4
- **Description:** Typed, bidirectional links between any two records (causes/caused by, duplicate of, related, fixes, implements, affects, blocks, parent/child) with a Persian label for each direction, link actions on every record page, related-list widgets and use in conditions ("has an open linked problem"). A link is visible only when the user can read both ends.
- **Implementation:** `link(from_table, from_id, to_table, to_id, type)`; tenant-extensible `link_type`; both ends checked through the access provider.

#### PLT-033 Watchers, @mentions and following · دنبال‌کنندگان و اشاره
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice
- **Description:** Users follow records manually or through rules; an @mention adds the person as a watcher and notifies them only if they can read the record (otherwise the author is warned); watchers get participant read access (ACC-033); a "watched by me" list.
- **Implementation:** `watcher` (source manual, mention or rule); mention parser; access check per mentioned user.

#### PLT-034 Record and response templates · الگوهای رکورد و پاسخ
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, Freshservice, ManageEngine SDP, HaloITSM
- **Description:** Record templates pre-fill any fields (including assignment, categorisation and tasks) and appear in the "new" menu, quick actions and recommendations; response templates (canned replies) with placeholders, folders and personal or group visibility are inserted from the composer with "/". Templates are versioned, translatable and scoped per workspace.
- **Implementation:** `record_template`, `response_template`; placeholder engine shared with notifications; visibility through audiences (ACC-040).

#### PLT-035 Checklists · چک‌لیست‌ها
- **Tier:** P1 · **AI:** no · **Sources:** ManageEngine SDP, ServiceNow, Freshservice
- **Description:** Checklist templates attached to records by model or rule (onboarding steps, change verification, audit steps); items with assignee, due date, done by/at and a mandatory flag; a transition can require all mandatory items to be done.
- **Implementation:** `checklist`, `checklist_item`; transition guard `requires_checklist_complete`.

#### PLT-036 Optimistic concurrency and presence · همزمانی خوش‌بینانه و نمایش حضور
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, Zendesk, JSM
- **Description:** Every update carries the row revision; a stale update returns a Persian conflict message with a field-level merge dialog; presence markers show who is viewing or editing a record and warn before two agents reply at the same time.
- **Implementation:** `rev` column and HTTP 409; presence through light pulse entries that are ephemeral and never synced.

#### PLT-037 Soft delete, trash and restore · حذف نرم و بازیابی
- **Tier:** P0 · **AI:** no · **Sources:** ManageEngine SDP, JSM, ServiceNow
- **Description:** Deletion is soft by default, with a trash per table, restore within a retention period (30 days by default), permanent purge under a separate right and audited delete events; records under legal hold cannot be deleted (ACC-028).
- **Implementation:** `deleted_at`, `deleted_by`; purge job; tombstones propagate to sync clients.

#### PLT-038 Record merge and duplicate detection · ادغام رکوردها و تشخیص تکراری
- **Tier:** P1 · **AI:** yes · **Sources:** ManageEngine SDP, Freshservice, JSM, BMC Helix
- **Description:** Merge duplicate tickets, people or CIs while choosing the surviving value per field; journals, links, watchers and attachments move to the survivor, and the merged record becomes a closed pointer. While creating or triaging, duplicate suggestions combine exact keys with semantic similarity and show a confidence score.
- **Implementation:** `merge_log`; similarity search over the RAG index (PLT-064) restricted to readable records; AI-suggested merges are proposals that a person confirms.

#### PLT-039 Record collaboration threads · گفت‌وگوی همکاری روی رکورد
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, Zendesk, JSM, BMC Helix
- **Description:** Real-time discussion threads on a record for swarming; invited experts receive a participant share for the life of the discussion; side conversations by e-mail or messenger with external parties; an AI catch-up summary for late joiners that can be posted to the work notes.
- **Implementation:** `discussion`, `discussion_message` (journal kind `chat`); invitees through shares (ACC-036); summary skill from the AI module.

#### PLT-040 UI policies (form rules) · سیاست‌های فرم
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, ManageEngine SDP, Zammad, JSM
- **Description:** Conditions on the current form and user decide which fields are visible, mandatory or read-only, set or clear values, filter options and show messages, on load, on change and on submit. Mandatory and read-only effects are re-checked on the server, so imports, APIs and sync cannot bypass them.
- **Implementation:** `ui_policy` using the condition language; client evaluator plus server validation; ordered with a stop flag.

#### PLT-041 Business rules · قواعد کسب‌وکار
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, GLPI, RT, BMC Helix
- **Description:** Server rules before/after insert, update and state change: conditions → set fields (literal, `$now`, `$me`, copy from field), add a work note, add/remove watchers, create a related record from a template, or abort with a Persian message. Rules are ordered, can stop further processing, are scoped per workspace or domain and log each execution on the record.
- **Implementation:** `business_rule` registered as engine hooks on every write path; side effects outside the transaction go through jobs; rules with side effects run once, on the runtime where the user acted.

#### PLT-042 Time-based rules · قواعد زمان‌محور
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, ManageEngine SDP, ServiceNow, JSM
- **Description:** Rules evaluated periodically over open records with time conditions (hours since created, pending, resolved, last requester or agent reply, due) plus field conditions → set fields, notify, escalate or close; for example auto-close resolved tickets after N business days, remind requesters who have not answered, escalate idle tickets. Times are business-time aware.
- **Implementation:** `time_rule` evaluated by a job with compiled SQL; idempotency key `(rule, record, period)`.

#### PLT-043 Assignment rules engine · موتور قواعد واگذاری
- **Tier:** P0 · **AI:** yes · **Sources:** Freshservice, BMC Helix, ServiceNow, GLPI, ManageEngine SDP
- **Description:** Ordered rules: conditions → target group or person with method fixed, round-robin, least-loaded, skills (proficiency levels), on-call or AI-suggested; availability gating (shift, out-of-office, minimum time left in the shift); ties broken by the oldest last assignment; a "preview" that explains which agent would be chosen and why; assignment only into groups of the record's workspace.
- **Implementation:** `assignment_rule`; decision trace stored on the record; shifts and skills from the workforce module; the AI method calls the routing skill under the record's access rules.

#### PLT-044 Priority matrix · ماتریس اولویت
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4, ServiceNow, Freshservice, BMC Helix, COBIT 2019
- **Description:** Impact × urgency → priority per table and workspace (ITIL defaults 1–5) in an editable, versioned grid; optional modifiers (VIP, service criticality, major-incident flag) and manual override with a reason.
- **Implementation:** `priority_matrix` versions; priority computed in a before hook; the matrix version is pinned on the record (PLT-012).

#### PLT-045 Category trees and versioned classification · درخت دسته‌بندی و طبقه‌بندی نسخه‌دار
- **Tier:** P0 · **AI:** no · **Sources:** BMC Helix, ServiceNow, ISO/IEC 20000-1, COBIT 2019, SIAM BoK
- **Description:** Category trees per table and workspace (operational, product/service, resolution, cause codes) with default group, template and SLA hints; effective-dated versions so historical reports stay correct; mapping of retired to new categories; a shared data dictionary exportable to SIAM partners.
- **Implementation:** `category` tree with closure rows; `valid_from/valid_to`; re-mapping jobs on reorganisation.

#### PLT-046 Flow designer and runtime · طراح و موتور گردش‌کار
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, BMC Helix, HaloITSM
- **Description:** No-code automation. Triggers: record event with conditions, schedule (Jalali presets), inbound e-mail, inbound webhook, catalog order, manual with inputs. Nodes: update/create record, comment, notify, request approval and wait, wait for a condition or a business-time duration, if/else and switch, parallel with join, for-each, subflow, HTTP call, JSON parse, expression, record lookup, connector action, AI skill or agent step, end. Data pills, error paths and retries, versions (runs keep theirs), run-as the triggering user or a named service principal, test runs on a chosen record, step-by-step logs, loop and step-count guards, metering, and flows drafted from a Persian description for review in the designer.
- **Implementation:** `flow`, `flow_version`, `flow_run`, `flow_run_step`; a deterministic executor runs until a wait and resumes through jobs; visual builder on `@xyflow/react` with RTL auto-layout.

#### PLT-047 Decision tables · جدول‌های تصمیم
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice
- **Description:** Ordered rows of conditions → outcomes (approver by amount and department, risk by change type and CI class, group by category and location), first-match or all-matches, used by flows, approval rules, assignment and risk calculations, with test inputs and gap/overlap warnings.
- **Implementation:** `decision_table` with versioned rows; evaluated by the condition engine; edited as a grid.

#### PLT-048 Playbooks and guided processes · راهنمای گام‌به‌گام فرایند
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, JSM, ManageEngine SDP, BMC Helix
- **Description:** Stage-based guidance cards inside the record workspace (major incident, onboarding, RCA): activities are instructions, forms, checklists, flows or AI-agent steps; activities can be optional or required; permissions per stage; progress and the next best step are shown on the record.
- **Implementation:** `playbook` definitions and `playbook_run` per record; activities call flows and AI skills.

#### PLT-049 Sentence-style automation recipes · دستورهای خودکارسازی جمله‌ای
- **Tier:** P1 · **AI:** yes · **Sources:** monday service, JSM, Freshservice
- **Description:** "When X happens, if Y, do Z" recipes written as Persian sentences with blanks, for team leads and other non-admins, compiled into flows; a recipe gallery and an AI box that turns a typed sentence into a recipe for review.
- **Implementation:** recipe templates map to flow graphs; a recipe acts only on records its author may write.

#### PLT-050 Expression language and sandboxed scripting · زبان عبارت و اسکریپت ایزوله
- **Tier:** P1 · **AI:** yes · **Sources:** Freshservice, ManageEngine SDP, ServiceNow, Ivanti
- **Description:** A typed expression language (string, math, date with Jalali and business-time functions, conditionals, lists) for computed fields, flow steps and templates; an optional sandboxed JavaScript step for advanced admins (time and memory limits, no network except allowlisted connectors, no direct database access: every call goes through the record service under the run's identity); AI drafts expressions and scripts from a description, shown with test cases for review.
- **Implementation:** parser with static typing at publish time; QuickJS or isolated-vm sandbox; execution logs show resolved values.

#### PLT-051 Approval engine · موتور تأیید
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, BMC Helix, ManageEngine SDP, ITIL 4, ISO/IEC 27001
- **Description:** Single or multi-level approvals, sequential or parallel, with rules any/all/count/percent/first response; approver sources: users, groups, the requester's manager or n-th manager, unit head, CI or service owner, CAB, record field, decision table, authority matrix (ACC-042); auto-approval conditions; levels without approvers are skipped; reminders, expiry and escalation; clarification requests; mandatory reason on rejection; decisions from the portal, e-mail (signed one-time links), mobile, messengers (INT-018) and chat; step-up or e-signature for sensitive approvals (ACC-073); delegation (ACC-061); siblings marked "no longer required"; SoD checks (ACC-041); an approvals inbox with bulk decisions.
- **Implementation:** `approval`, `approval_rule`; the record's `approval` field aggregates state; events `approval_requested/decided`; each decision stores channel and authentication strength.

#### PLT-052 Timer and SLA runtime engine · موتور زمان‌سنج و SLA
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, BMC Helix
- **Description:** Generic timers attachable to any table through definitions owned by the slm module: start/pause/stop/reset/cancel conditions, retroactive start, calendar and time-zone source, percent warnings (50/75/90) and breach actions that fire exactly once, recalculation on priority change, lazy computation on read and a timeline of a record's timers.
- **Implementation:** `task_sla` runtime rows; business-time arithmetic from PLT-053; jobs with dedupe keys emit `sla_warning` and `sla_breach`.

#### PLT-053 Business calendars and Iranian holidays · تقویم‌های کاری و تعطیلات رسمی ایران
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, ManageEngine SDP, JSM, ISO/IEC 27001
- **Description:** Calendars with several working intervals per weekday, time zone, weekend (Friday, optionally Thursday or half-day Thursday), child schedules, holiday sets (official Iranian holidays seeded per year, lunar dates marked «پیش‌بینی» until confirmed, provincial and company closures, half days) and maintenance/blackout windows; used by SLAs, on-call, auto-close, change windows and reports.
- **Implementation:** `calendar`, `holiday_set`, `holiday`; pure business-time functions in `src/shared` tested for overnight shifts and half days; cached per calendar and day.

#### PLT-054 Jalali-native dates, periods and fiscal year · تاریخ و دوره‌های جلالی بومی
- **Tier:** P0 · **AI:** no · **Sources:** our design (Persian context)
- **Description:** Jalali input and display everywhere (pickers, lists, exports, notifications, PDFs); weeks starting Saturday; Jalali months, quarters and years in relative filters and aggregates; the Iranian fiscal year for KPIs and budgets; dual Jalali + Gregorian display for external parties; Gregorian and Hijri conversion helpers.
- **Implementation:** UTC storage; Jalali bucketing shared by SQL (generated boundary table) and JS; `formatJalali()` everywhere.

#### PLT-055 Scheduled jobs and recurring records · زمان‌بندی‌ها و رکوردهای تکرارشونده
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, JSM, Freshservice
- **Description:** Recurrence rules with Jalali support («روز اول هر ماه») that create records from templates (preventive maintenance, monthly checks) and run scheduled flows, reports and exports; next-run preview, "skip holidays" option, an owner and failure alerts.
- **Implementation:** `schedule` table; the job tick claims due occurrences; idempotent per `(schedule_id, occurrence)`.

#### PLT-056 Planned-interval review engine · موتور بازبینی‌های دوره‌ای
- **Tier:** P1 · **AI:** no · **Sources:** ISO/IEC 20000-1, ISO/IEC 27001, COBIT 2019, KCS
- **Description:** Rules (object type + scope filter + frequency + task template + owner resolution + grace period + required evidence) generate the reviews standards require "at planned intervals": SLA, OLA and contract reviews, CMDB verification, continuity tests, supplier reviews, access recertification, policy and KB-article reviews. Completion captures evidence (attachment, checklist, sign-off); overdue reviews escalate and can raise a nonconformity candidate.
- **Implementation:** `review_rule`, `review_task` (REV) generated idempotently per `(rule, period, target)`; KPI "% reviews completed on time" per standard.

#### PLT-057 Regulatory clock engine · موتور مهلت‌های قانونی
- **Tier:** P2 · **AI:** no · **Sources:** EU DORA, NIS2, GDPR, NIST SP 800-61r3
- **Description:** Calendar-time clocks (not business time) computed from explicit "became aware" and "classified" timestamps for statutory deadlines such as 24 h / 72 h / one-month reports and breach notifications, plus local regulator notices where applicable; several regimes per record, report templates, reminders and a submission log as evidence.
- **Implementation:** regimes as data; clocks are timer instances on a 24×7 calendar; submissions stored as evidence records.

#### PLT-058 Notification engine · موتور اعلان
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, BMC Helix, ITIL 4, ISO/IEC 20000-1
- **Description:** Rules: event (created, updated, state changed, assigned, commented, SLA warning/breach, approval requested/decided, mentioned, custom) + conditions → recipients (record fields, users, groups, roles, watchers, assignee, requester, manager, on-call, external stakeholders) → channels (in-app, e-mail, SMS, messengers, Teams/Slack, push, webhook, voice). Persian RTL templates with placeholders and conditionals are rendered per recipient under that recipient's access and field masks: a recipient who cannot read the record gets nothing and hidden fields become placeholders. Actor suppression, digests, quiet hours, opt-outs (except mandatory notices), approval of external statements and a delivery log kept as evidence.
- **Implementation:** `notification_rule`, `notification_template`, `notification_log`, `notification_pref`; evaluated on record events; delivered by jobs with retries through channel adapters from the integration module.

#### PLT-059 In-app notification center · مرکز اعلان درون‌برنامه
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice
- **Description:** A bell with a live unread count, a drawer grouped into direct, watching, approvals and system, mark-all-read, filters, snooze and deep links into the record tab; on web, desktop and the PWA (web push).
- **Implementation:** `notification` inbox rows (own scope only); pulse refresh; web push with VAPID keys.

#### PLT-060 Email-to-record engine · موتور ایمیل به رکورد
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, BMC Helix, Freshservice, JSM, ManageEngine SDP, Znuny
- **Description:** Inbound mail creates records of the table configured per mailbox and workspace, matches the sender to a user or external contact, threads replies by the `[NUMBER]` token and Message-ID/In-Reply-To/References, adds replies as public comments, saves attachments, strips quoted text and signatures, and blocks loops (auto-replies, bulk mail, our own Message-IDs) with allow/deny lists. Reply classification (acknowledgement vs real update, reopen intent) decides whether to reopen or change state; parsing rules extract fields from structured mail such as monitoring alerts.
- **Implementation:** `email_message` log; IMAP/Graph polling jobs (INT-015); optional AI classification with a deterministic fallback.

#### PLT-061 Surveys and assessments engine · موتور نظرسنجی و ارزیابی
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, Freshservice, HappySignals, ITIL 4
- **Description:** Generic questionnaires (rating, 0–10 NPS, choice, yes/no, matrix, free text) triggered on any table (record closed, change implemented, quarterly relationship survey) with per-person throttling, an anonymous option, scoring and weights; an assessment mode (metrics, categories, decision matrix) reused for change risk, vendor risk and maturity assessments. AI drafts questionnaires and groups free-text answers into themes.
- **Implementation:** `survey`, `survey_question`, `survey_instance` (SVY), `survey_response`; delivery by notifications, portal and messengers; results feed analytics.

#### PLT-062 Global search · جست‌وجوی سراسری
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, ManageEngine SDP, ITIL 4
- **Description:** One search box over records, people, knowledge, catalog and CIs: exact number match, full text with Persian normalisation, trigram typo tolerance, synonyms and stop words, facets by table, state and date, keyboard navigation, recent searches and "include archived" for authorised users. Results and counts are always filtered by the caller's access; search analytics record zero-result queries and click-through.
- **Implementation:** Postgres full text with a Persian configuration plus `pg_trgm`; per-table search fields; predicate from the access provider; `search_log`.

#### PLT-063 Persian language services · خدمات زبان فارسی
- **Tier:** P0 · **AI:** no · **Sources:** our design (Persian context)
- **Description:** Normalisation of Arabic/Persian letter variants (ي/ی، ك/ک، ة، ۀ), zero-width non-joiner handling, diacritics removal, digit unification, Persian stemming and stop words, Finglish transliteration so that «sabt darkhast» finds «ثبت درخواست», wrong-keyboard-layout correction, Persian collation for sorting, number-to-words for documents, and validation of Persian names, national IDs and phone numbers.
- **Implementation:** shared `src/shared/fa/*` functions used in JS and as SQL functions or generated columns; the same normalisation for the search index, RAG chunks and filters.

#### PLT-064 Semantic search and RAG indexing · نمایه‌سازی معنایی و RAG
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, JSM, BMC Helix, Moveworks, Glean
- **Description:** Every table with `features.rag` is indexed in structure-aware chunks per field group (public fields, internal notes, HR and financial text kept apart), with AI-written resolution digests for tickets, embeddings from the tenant's own provider (cloud or local) or a local fallback, hybrid retrieval (vector + full text with rank fusion) and small-to-big expansion. Each chunk carries the record's access keys, classification and domain; chunks are re-keyed in the same transaction as an ACL change or marked stale and excluded; a nightly job reconciles chunk keys with record keys.
- **Implementation:** `ai_chunk` (pgvector when available, JSON vectors with JS cosine on PGlite); indexing jobs from record events; retrieval rules in ACC-084.

#### PLT-065 Import framework · چارچوب ورود داده
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, Freshservice, JSM, BMC Helix
- **Description:** CSV, XLSX and JSON import into any table: column mapping with saved templates, coalesce keys (insert or update), value transforms and look-ups (names → references), Jalali date parsing, a dry run with per-row validation, batched commit, downloadable error rows, a choice to run business rules or not, scheduled imports from connectors and a full audit of who imported what.
- **Implementation:** `import_run` (IMP) with staging rows; the record service's validation; large imports run as jobs.

#### PLT-066 AI-assisted import mapping and document extraction · نگاشت هوشمند ورود داده و استخراج از سند
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, OpenText SMAX, Ivanti
- **Description:** AI proposes column-to-field and value mappings for spreadsheets (including Persian headers), fills forms from screenshots, scanned letters or PDFs with Persian OCR, and extracts fields from invoices and contracts. Every extracted value is a suggestion with a confidence that a person confirms.
- **Implementation:** vision-capable model from the tenant's provider (capability guard); results stored as `ai_suggestion`; never committed automatically.

#### PLT-067 Export · خروجی گرفتن
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, ManageEngine SDP, JSM
- **Description:** Export lists and reports to CSV, XLSX, PDF and JSON with the screen's column projection and field masks, Jalali or Gregorian dates and Persian headers; large exports run asynchronously (zipped parts, link by notification); exporting sensitive field classes needs step-up authentication and is logged (ACC-044).
- **Implementation:** `export_run` (EXP); rows streamed through the access predicate; XLSX built on the server or in the UI.

#### PLT-068 Bulk operations · عملیات گروهی
- **Tier:** P0 · **AI:** no · **Sources:** JSM, ManageEngine SDP, ServiceNow
- **Description:** Bulk update, assign, transition, comment, link, merge and delete on a selection or a filter, with a preview of affected counts, validation per record (transition rules, mandatory fields, SoD), background execution for large sets, a result report and an undo window for reversible changes; requires the `bulk_update` right.
- **Implementation:** `bulk_job` (BLK); every item goes through the normal write path; before-images kept for undo.

#### PLT-069 Data dictionary and schema introspection · فرهنگ داده و معرفی ساختار
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, JSM
- **Description:** A browsable data dictionary (tables, fields, types, choices, relations as an ERD, field classes, using modules) filtered to what the viewer can read; the same metadata generates the OpenAPI spec, the MCP tool descriptions and the AI tool `describe_tables`, so assistants understand each tenant's custom schema.
- **Implementation:** generated from the registry plus tenant customisations; ERD with an accessible table alternative.

#### PLT-070 Transactional outbox, event bus and job queue · صف رویداد و کارهای پس‌زمینه
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4, ServiceNow, JSM, our fork
- **Description:** Every write emits events into the outbox in the same transaction. A job queue (kinds, lanes, dedupe keys, retries with backoff, run-at times, `skip locked` claiming, time budgets per tick, fairness per tenant) dispatches them to subscribers: notifications, SLA, rules, flows, AI indexing, webhooks and sync re-keying. Ticks come from the desktop timer, the cloud cron and after write requests.
- **Implementation:** `job` and `event` (`sm_jobs`); `enqueue(tx, job)`; handlers return continue/wait/done/fail; dead jobs visible in ADM-031.

#### PLT-071 Live updates · به‌روزرسانی زنده
- **Tier:** P0 · **AI:** no · **Sources:** our fork, ServiceNow, JSM
- **Description:** Open lists, boards, dashboards and record pages refresh within seconds when data changes on any device, without touching forms being edited; polling adapts to activity and stops when the window is hidden.
- **Implementation:** forked `pulse` endpoint on the org revision counter; targeted invalidation per table.

#### PLT-072 Sync engine · موتور همگام‌سازی
- **Tier:** P0 · **AI:** no · **Sources:** our fork, ServiceNow, PowerSync/ElectricSQL patterns
- **Description:** Push/pull between the cloud and Windows replicas per aggregate (record and children) with a revision cursor, a conflict policy (newer cloud version wins, history kept), renumbering of numbers created offline, tombstones when a record leaves the user's scope, a full re-pull when the user's scope epoch changes, lazy attachment content and validation of every pushed write by the record service.
- **Implementation:** sync registry generated from table definitions; pull filtered by access buckets (ACC-056); `scope_epoch` per member.

#### PLT-073 Windows desktop app, offline replica and LAN mode · برنامهٔ ویندوز آفلاین با حالت شبکهٔ محلی
- **Tier:** P0 · **AI:** yes · **Sources:** our fork, ServiceNow, ISO 55001
- **Description:** A Windows installer runs the same API and UI on a local PostgreSQL (PGlite) holding the records the user may read; it works fully offline (create, update, comment, attach), syncs automatically, keeps automatic local backups, can serve phones and PCs on the same LAN (network mode with QR pairing) and uses AI through the cloud relay or a local model; offline AI sees only the replica.
- **Implementation:** Electron utility process; encrypted local database (ACC-056); update channels (ADM-036); AI relay `POST /ai/relay`; local models through an OpenAI-compatible endpoint.

#### PLT-074 Installable PWA for phones · برنامهٔ وب نصب‌شدنی برای گوشی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, BMC Helix
- **Description:** The web app installs on Android and iOS without an app store: requester and agent views, approvals, web-push notifications, camera barcode/QR scanning for assets, voice input, and an offline cache for field work with queued updates, under the same access rules and audit as the web.
- **Implementation:** manifest and service worker; queued mutations replayed through the normal write path; scanning via `BarcodeDetector` with a WASM fallback.

#### PLT-075 Native mobile apps · برنامه‌های بومی موبایل
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, JSM, ManageEngine SDP, BMC Helix
- **Description:** Native Android apps (direct APK and local stores such as Bazaar and Myket) and iOS apps for agents and requesters where the PWA falls short: background sync, RFID readers, rich push and home-screen widgets.
- **Implementation:** wrap the PWA (Capacitor) on the same API; distribution that does not depend on Google Play.

#### PLT-076 AI placement points in the UI · نقاط حضور هوش مصنوعی در رابط
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, Freshservice, JSM, BMC Helix
- **Description:** Standard places where AI skills appear on every table: a contextual side panel that knows the record; context-menu actions on text fields (summarise, shorten, expand, formal/informal tone, translate, turn into a KB article); suggestion cards for fields (category, group, priority) with accept/edit/reject; voice input; an "ask about this list" entry on list pages. Each placement is gated by the skill's permission and the AI-channel policy.
- **Implementation:** UI slots from PLT-013; skills registered by the AI module; outputs are suggestions unless the skill's policy allows automatic application.

#### PLT-077 AI provenance and transparency marks · نشان‌گذاری و ردپای محتوای هوش مصنوعی
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, TOPdesk, HaloITSM, Zammad, EU AI Act
- **Description:** Every value, journal entry, article or record created or changed by AI carries a visible mark («پیشنهاد هوش مصنوعی»، «ثبت‌شده توسط عامل»), the run id, model and prompt version, the person who accepted it and whether it was edited; lists can filter by AI involvement; AI output shown to requesters is labelled as such.
- **Implementation:** `ai_run_id` on history and journal rows; `origin` column on records; a shared badge component; kept for evaluation and audit.

#### PLT-078 Dynamic translation of record content · ترجمهٔ پویای محتوای رکورد
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, Freshservice, TOPdesk, Ivanti, Zendesk
- **Description:** Detects the language of comments, e-mails and chats and translates them for the agent (Persian, English, Arabic and more) while keeping the original; agents answer in Persian and the requester receives their own language; translated text is labelled.
- **Implementation:** translation skill on the tenant's provider or a local model; cached per entry; blocked when the AI-channel policy forbids sending the content out.

#### PLT-079 Management-system kernel · هستهٔ نظام مدیریت
- **Tier:** P1 · **AI:** no · **Sources:** ISO/IEC 20000-1, ISO/IEC 27001, ISO 22301, ISO/IEC 42001, ISO/IEC 19770-1, ISO 55001
- **Description:** One object set reused by every ISO management-system standard (harmonized structure, clauses 4–10): context issues (with the 2024 climate-relevance field), interested parties and their requirements, scope statement, policies, objectives (target, owner, due date, evaluation method), risks and opportunities, roles and authorities, competence and awareness records, communication plan, internal audit programme and findings, management reviews, nonconformities and corrective actions, and the improvement register. Each object is tagged with the standards it serves, so one audit can cover several standards.
- **Implementation:** kernel tables (see Data model) with `standards[]` tags; nonconformities use task behaviour; recurring reviews come from PLT-056.

#### PLT-080 Requirement and control library with crosswalks · کتابخانهٔ الزامات و کنترل‌ها با نگاشت متقابل
- **Tier:** P1 · **AI:** yes · **Sources:** ISO/IEC 20000-1, ISO/IEC 27001, NIST CSF 2.0, COBIT 2019, ISO/IEC 42001, FitSM, SOC 2, PCI DSS
- **Description:** Clauses, controls and subcategories stored as data with many-to-many crosswalks; every requirement links to policies, procedures, controls, owners, operational records and evidence, with a status (not started, partial, implemented, effective) and gap notes. AI suggests cross-framework mappings and checks whether attached evidence plausibly satisfies a control test.
- **Implementation:** `ms_standard`, `ms_requirement`, `ms_mapping`, `control`, `control_requirement`, `evidence`; AI suggestions need reviewer acceptance.

#### PLT-081 Documented-information control · کنترل اطلاعات مستند
- **Tier:** P1 · **AI:** no · **Sources:** ISO/IEC 20000-1, ISO/IEC 27001, FitSM
- **Description:** A document register (policy, plan, procedure, work instruction, template, record, external document) with owner, version, classification, lifecycle Draft → In review → Approved → Published → Under revision → Superseded/Retired, approvers and dates, review frequency, a distribution list with read-and-acknowledge attestation, retention and disposition, a change log and a mandatory-document checklist per standard.
- **Implementation:** `document` (DOC) with task behaviour and `document_ack`; reviews from PLT-056; publishing stores an immutable PDF snapshot.

#### PLT-082 Evidence and audit pack export · بستهٔ شواهد ممیزی
- **Tier:** P1 · **AI:** yes · **Sources:** ISO/IEC 20000-1, ISO/IEC 27001, SOC 2, COBIT 2019
- **Description:** For a chosen requirement set and period, export the policy versions in force, complete record populations plus samples, review completions, approvals, test results and hash proofs (PLT-030) as PDF, CSV and JSON; AI drafts the narrative per requirement and flags missing or weak evidence.
- **Implementation:** `evidence_pack` (EPK) job; populations built through the auditor's access predicate; signed hash manifest.

#### PLT-083 Value-stream modeler and flow metrics · مدل‌ساز جریان ارزش
- **Tier:** P2 · **AI:** no · **Sources:** ITIL 4, ITIL v5, IT4IT
- **Description:** Value streams (incident-to-resolution, request-to-fulfilment, change-to-deploy, onboarding) as ordered steps tagged with value-chain activities and practices; workflow states are bound to steps, so each record emits step entry and exit events that give lead time, cycle time, wait time and flow efficiency per stream.
- **Implementation:** `value_stream`, `value_stream_step`; step events derived from history; rendered by the analytics module.

### Data model

Physical tables are `sm_<plural>`. Every row carries the engine base columns (`id` UUID v7, `org_id`, `workspace_id?`, `domain_id?`, `unit_id?`, `created_at/by`, `updated_at/by`, `rev`, `deleted_at`, `origin`, `custom jsonb`). Business records additionally carry the access columns of the access module (`acl_keys`, `security_level_id`, `restricted_group_id`, `classification`, `external_visible` …). State categories: new, active, waiting, resolved, closed, canceled.

| Table | Key fields | States (category) | Prefix | Relationships | Access scoping |
|---|---|---|---|---|---|
| `custom_field` | table_key, name, type, labels{fa,en}, field_class, required_on, requester_visible, choices_key, ref_table, searchable, filterable, version | active, inactive | — | registry table or `custom_table` | config admins (ACC-024); `workspace_id`/`domain_id` overrides |
| `custom_table` | key, labels, extends, number_prefix, state_model, features, scope_fields, version | draft (new) → published (active) → archived (closed) | — | has many `custom_field` | config admins; registers an area key for grants |
| `choice` | list_key, value, labels{locale}, order, color, parent_value, active, valid_from/to | active, inactive | — | parent `choice` | read with the table; write by config admins; workspace/domain override |
| `view` | table_key, kind (list/kanban/calendar/timeline), owner_id, audience_id, columns, filter, sort, group_by, density | — | — | owner `user`, `audience` | own (`owner_id`) + audience binding |
| `form_layout` | table_key, persona, workspace_id, domain_id, model_id, sections, tabs, related_lists, version | draft (new) → published (active) | — | table, `record_model` | config admins |
| `record_model` | table_key, key, version, criteria, state_variant, required_by_state, approvals, task_templates, sla_refs, comm_templates, review_cadence | draft (new) → published (active) → retired (closed) | MDL | records store `model_id`, `model_version` | config-object owner (ACC-025); workspace/domain |
| `journal` | table_key, record_id, kind, visibility, body, author_id, on_behalf_of, ai_run_id, attachments, action_at | append-only | — | parent record | parent `acl_keys`; internal entries drop requester/external keys |
| `history` | table_key, record_id, seq, field, old, new, actor_id, actor_kind, channel, reason, at, prev_hash, hash | append-only | — | parent record | parent keys + field mask (hidden field = «تغییر کرد») |
| `audit_anchor` | table, day, merkle_root, exported_to, exported_at | — | — | `history` | auditors, security admins |
| `attachment`, `blob` | table_key, record_id, journal_id, name, mime, size, sha256, blob_id, scan_status, classification / sha256, size, storage_ref | scan: pending (new) → clean (active) / quarantined (canceled) | — | parent record; blob dedupe | parent keys (ACC-048) |
| `link`, `link_type` | from_table, from_id, to_table, to_id, type / key, label_out, label_in | — | — | two records | both ends must be readable |
| `watcher` | table_key, record_id, user_id, source | — | — | record, user | adds a `par:` key to the record |
| `checklist`, `checklist_item` | record ref, template_id / title, mandatory, assignee_id, due_at, done_by, done_at | open (active) → done (closed) | — | record | parent keys |
| `discussion`, `discussion_message` | record ref, title, invitees / author_id, body | open (active) → closed | — | record | parent keys + invitee shares |
| `merge_log` | table_key, survivor_id, merged_ids, field_choices, actor_id | — | — | records | parent keys |
| `ui_policy`, `business_rule`, `time_rule`, `assignment_rule`, `priority_matrix`, `category`, `decision_table`, `record_template`, `response_template`, `checklist_template` | table_key, conditions, actions/outcomes, order, stop, workspace_id, domain_id, version, active | draft (new) → active → inactive (closed) | — | target table | config admins/owners; workspace/domain; response templates also personal or group |
| `playbook`, `playbook_run` | key, stages, activities, version / playbook_id, version, record ref, stage, activity_state | definition: draft → published; run: active → completed (closed) / canceled | PBK | record | definition: config owner; run: parent keys |
| `flow`, `flow_version` | key, name, trigger, graph, run_as, owner_id / version, graph, published_at/by | draft (new) → published (active) → inactive (closed) | FLW | versions, runs | owner + flow admins; workspace/domain |
| `flow_run`, `flow_run_step` | flow_id, version, trigger_ref, state, context, current_nodes, started_at, ended_at, error / node_id, attempt, status, input, output, error | running (active), waiting (waiting), completed (closed), failed (closed), canceled (canceled) | — | flow, record | flow owners and admins; readers of the record see a run summary |
| `approval`, `approval_rule` | record ref, approver_id, group_id, rule, level, sequence, state, due_at, decided_by, decided_via, auth_strength, comment, delegated_from / table, conditions, sources, levels, mode, auto_conditions, reminders, expiry, sod_mode | requested (waiting) → approved / rejected (resolved); skipped, no_longer_required, canceled (canceled) | APV | record, `delegation` | approver `par:` share + record readers |
| `task_sla` (runtime; definitions owned by slm) | record ref, definition_id, definition_version, stage, start_at, paused_total, business_elapsed, planned_end_at, breached_at, percent | in_progress (active), paused (waiting), achieved (closed), breached (closed), canceled (canceled) | — | record, `sla_definition` | parent keys |
| `calendar`, `holiday_set`, `holiday` | name, timezone, intervals, weekend, parent_id, holiday_set_ids / key, region / jalali_date, gregorian_date, title, half_day, kind, confirmed | holiday: predicted (waiting) → confirmed (active) | — | calendar ↔ sets | read by all; write by config admins; workspace/domain overrides |
| `schedule` | kind, rrule, jalali_rule, template_ref, flow_id, next_run_at, skip_holidays, owner_id | active, paused (waiting), ended (closed) | SCH | template, flow | owner + admins |
| `review_rule`, `review_task` | object_type, scope_cond, rrule, task_template, owner_resolution, grace_days, evidence_required, standards[] / rule_id, period, target ref, owner_id, due_at, evidence_refs | new → open (active) → submitted (waiting) → accepted (resolved) → closed; canceled | REV | target record, `evidence` | own (owner), group, compliance roles, target's unit |
| `notification_rule`, `notification_template`, `notification`, `notification_log`, `notification_pref` | event, table, conditions, recipients, channels, template_id, digest / subject, body, locale / user_id, title, body, link, read_at / channel, recipient, status, provider_msg_id, error, rendered_hash / user_id, event, channel, digest, quiet_hours | log: queued (new) → sent (active) → delivered (closed) / failed (canceled) | — | rule → template; log → record | inbox and prefs: own; logs: admins + the recipient; rules: config admins |
| `email_message` | mailbox_id, direction, message_id, in_reply_to, references, from, to, subject, record ref, classification, status | received (new) → processed (closed) / rejected (canceled) | — | `mailbox`, record | parent record keys; mailbox admins |
| `survey`, `survey_question`, `survey_instance`, `survey_response` | trigger, table, scoring / type, options / record ref, recipient_id, sent_at, answered_at / answers, score | sent (waiting) → answered (closed) / expired (canceled) | SVY | record, user | recipient own; survey owners; aggregate-only for others (ACC-050) |
| `search_synonym`, `search_log` | terms, locale / user_id, query, result_count, clicked, latency_ms | — | — | — | log: own + aggregates for admins |
| `ai_chunk` | table_key, record_id, field_group, chunk_no, content, tsv, embedding, model, hash, acl_keys, classification, domain_id, version, stale | fresh (active), stale (waiting) | — | record | copied `acl_keys`; never read directly by users |
| `translation` | object ref, field, locale, text, source (human/machine), status | draft (new) → approved (active) | — | translated object | object's access |
| `user_pref` | user_id, locale, calendar, digits, timezone, density, theme, start_page, shortcuts | — | — | user | own |
| `import_run` | table_key, source, mapping, coalesce_keys, mode, counts, error_blob_id | new → validating (active) → ready (waiting) → committed (closed); failed, canceled (canceled) | IMP | staged rows → records | own + import admins; rows validated with the importer's grants |
| `export_run` | table_key, filter, columns, format, row_count, blob_id, sensitive, stepup_at | queued (new) → running (active) → ready (closed); expired, failed (canceled) | EXP | — | own; admins see metadata only |
| `bulk_job` | table_key, filter_or_ids, action, patch, preview_count, results, undo_until | preview (new) → running (active) → done (closed); undone, canceled (canceled) | BLK | records | own; each item checked |
| `job`, `event` | kind, lane, payload, run_at, status, attempts, locked_until, dedupe_key, last_error / topic, table_key, record_id, changed_fields, actor | queued (new) → running (active) → done (closed) / failed, dead (canceled) | — | — | system principal; admins read (ADM-031) |
| `ms_standard`, `ms_requirement`, `ms_mapping`, `control`, `control_requirement`, `evidence` | code, version / standard_id, clause_ref, parent_id, text / req_a, req_b, strength / owner_id, type, frequency, status / requirement or control, record ref, period, hash, captured_by | requirement status: not_started (new), partial (active), implemented (resolved), effective (closed) | EVD (evidence) | requirement ↔ control ↔ evidence ↔ any record | compliance roles; owner (own); evidence inherits the source record's keys |
| `context_issue`, `interested_party`, `ms_scope`, `objective`, `internal_audit`, `audit_finding`, `nonconformity`, `management_review`, `improvement` | standards[], owner_id, unit_id, due_at, status; NC: source, severity, root_cause, actions; audit: programme, scope, auditors | NC: new → analysis (active) → action (active) → verification (waiting) → closed / canceled; audit: planned (new) → in_progress (active) → reported (resolved) → closed | AUD, FND, NC, MRV, CSI | requirements, risks, changes, records | own (owner), unit/unit_subtree, compliance and auditor roles |
| `document`, `document_ack` | type, owner_id, version, classification, review_due_at, retention, distribution_audience_id / user_id, version, acknowledged_at | draft (new) → in_review (waiting) → approved (active) → published (active) → under_revision (active) → superseded, retired (closed) | DOC | audiences, requirements | owner and approvers; published: audience |
| `evidence_pack` | requirement_set, period, items, manifest_hash, signed_by | building (active) → ready (closed) | EPK | evidence | auditor and compliance roles |
| `value_stream`, `value_stream_step` | name, steps, activity_tags, state_bindings | draft (new) → active | — | state models | config admins; analytics viewers |

### KPIs

| KPI | Formula | Source |
|---|---|---|
| Automation rate | records with ≥ 1 automated action (rule, flow, AI) ÷ records created | ITIL 4, analytics research |
| Zero-touch rate | records resolved with no human work step ÷ records resolved | analytics research (request KPIs) |
| Flow success rate | completed runs ÷ (completed + failed runs), per flow version | ServiceNow, JSM run statuses |
| Flow duration | p50 / p95 of (ended_at − started_at) per flow version, excluding waits | ServiceNow flow reporting |
| Job queue latency | p95 of (claimed_at − run_at) per lane | our design |
| Job failure rate | (failed + dead jobs) ÷ jobs executed | ITIL 4 (scheduled-job failure rate) |
| Notification delivery rate | delivered ÷ attempted, per channel; median send-to-delivery time | ISO/IEC 20000-1 §7.4 |
| E-mail threading accuracy | replies attached to the right record ÷ replies received; duplicate rate = records created from an existing thread ÷ records created from e-mail | BMC Helix 25.4 |
| Search success rate | searches followed by an opened result within 60 s ÷ searches; zero-result rate = zero-result searches ÷ searches | ITIL 4 (knowledge pitfalls) |
| Response time | p95 server time per API route and global search; LCP p75 per page | our design |
| Platform availability | (minutes in period − unplanned downtime minutes) ÷ minutes in period | ITIL 4 availability |
| Sync freshness | p95 of (cloud commit → desktop apply); conflict rate = conflicts ÷ pushed mutations; offline rejection rate = rejected proposals ÷ pushed mutations | our design |
| RAG index freshness | p95 of (chunk indexed_at − record updated_at); stale share = stale chunks ÷ chunks | access research (freshness is security) |
| AI suggestion acceptance | accepted ÷ (accepted + rejected), per skill; mean normalised edit distance of accepted drafts | AI research |
| Ownership compliance | records past triage with an owner ÷ records past triage | ITIL 4 ownership rule |
| Concurrent recording | journal entries written ≤ 15 min after the action ÷ entries with an action time | ITIL 4 incident guide (data quality) |
| Reviews on time | review tasks completed by due date ÷ review tasks due | ISO/IEC 20000-1, ISO/IEC 27001 |
| Evidence coverage | applicable requirements with evidence for the period ÷ applicable requirements | standards research |
| Audit-chain integrity | days with a verified anchor ÷ days in period (target 100%) | ISO/IEC 27001 A.8.15 |
| Accessibility defects | open WCAG 2.2 AA violations per release (target 0 critical) | WCAG 2.2 |
| Translation coverage | translated strings and content items ÷ total, per enabled locale | ITIL 4 localisation |

### Beyond the market

- **RTL and Jalali in the core, not a language pack.** Dates, periods, fiscal year, calendars, digits, bidi editors, print layouts and official-letter formats are native; no leading tool is fully RTL and Jira Cloud has no RTL at all.
- **Iranian holiday engine.** Official holidays seeded per year, lunar dates shown as predictions until an admin confirms them, provincial and short-notice closures (air pollution, heat, emergencies) applied to calendars at once with SLA due dates recomputed and a notice to affected requesters.
- **Persian language services shared by search, RAG and duplicate detection.** Letter normalisation, ZWNJ, Finglish and wrong-keyboard-layout correction; no studied tool normalises Persian text.
- **Permission-exact offline Windows replica with LAN mode.** Teams keep working through internet disruptions and on isolated networks, and phones on the same LAN connect to the office PC; no studied ITSM tool offers an offline replica for ITSM records.
- **AI with the tenant's own model, cloud or local.** A "no data leaves the network" mode pins every skill and embedding to local models, and the desktop can run AI on its replica.
- **Delivery that does not depend on foreign app stores or CDNs.** Installable PWA, direct APK, self-hostable update mirror, all fonts and assets bundled.
- **One condition language for everything.** Filters, rules, SLA, notifications, access grants and AI tools share one AST compiled to SQL and JS, so web, desktop and AI behave identically.
- **Compliance kernel open to local requirement packs.** The same requirement library can carry national requirements (for example AFTA security criteria or passive-defence checklists) next to ISO and NIST.

## Module: admin — مدیریت سامانه و پیکربندی

### Features

#### ADM-001 Admin console and settings hierarchy · کنسول مدیریت و سلسله‌مراتب تنظیمات
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, ServiceNow, JSM, ITIL 4
- **Description:** One searchable admin home split into tenant-wide settings (people and org, security, channels, AI, integrations, data, billing) and per-workspace settings (forms, states, SLAs, catalog, KB, notifications, flows, rules), with per-practice admin areas owned by practice owners; a typed settings registry with defaults, descriptions and validation; an "effective configuration" viewer that shows which level (platform default, tenant, workspace, domain) supplied each value; deep links into every designer.
- **Implementation:** `setting(key, scope, scope_id, value, version)`; resolution walks domain → workspace → tenant → default; admin pages registered per module.

#### ADM-002 Guided setup and onboarding checklists · راه‌اندازی هدایت‌شده و چک‌لیست شروع
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice
- **Description:** A setup checklist per tenant and workspace (org structure, people, groups, e-mail channel, calendars, catalog, notifications, AI provider, SSO) with progress; every empty list or dashboard shows one sentence, one primary action and a template gallery or sample data; sample data can be added and removed in one click; tips appear only where they apply.
- **Implementation:** `onboarding_task`; shared empty-state component; sample data shipped as a removable content pack.

#### ADM-003 Start-where-you-are onboarding · شروع از وضع موجود
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, JSM, Freshservice
- **Description:** Wizards import org units, locations, people, groups, services, CIs, assets, open tickets and knowledge from spreadsheets or connectors with prebuilt mappings, then show a data-quality report (duplicates, missing managers, empty groups, invalid national IDs) and a short current-state questionnaire that recommends which practices and workspaces to switch on first.
- **Implementation:** entity mapping templates on the import framework (PLT-065); quality checks as scan rules (ADM-018); the questionnaire is a survey (PLT-061).

#### ADM-004 AI configuration assistant · دستیار هوشمند پیکربندی
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP
- **Description:** Admins describe a need in Persian («یک میز خدمت منابع انسانی با سه نوع درخواست و تأیید مدیر») and the assistant drafts the artefacts — workspace, request types, forms, categories, groups, routing, SLAs, notifications, flows, roles — as proposals opened in the normal designers with a diff. Nothing applies until the admin publishes, and access-related drafts must pass the policy simulator (ACC-091).
- **Implementation:** AI tools emit declarative JSON validated with each designer's schema; proposals stored as draft configuration versions attributed to the AI run.

#### ADM-005 Templates and content packs · الگوها و بسته‌های محتوایی
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4, ITIL v5, JSM, ServiceNow, Freshservice
- **Description:** Importable packs of ready configuration and content, written in Persian: ITIL-aligned practice models, catalog items, KB and PIR/RCA templates, SLA and role templates, workspace templates (IT, HR, facilities, finance, legal, security), notification templates, dashboards and Iranian calendars. Packs are versioned and can be previewed, installed per workspace or domain, updated with a diff and removed.
- **Implementation:** `content_pack`, `content_pack_install`; packs are signed configuration packages (ADM-009).

#### ADM-006 Workspace (service desk) management · مدیریت میزهای خدمت
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, JSM, ManageEngine SDP, Xurrent
- **Description:** Create enterprise-service workspaces from templates (IT by default; HR, facilities, finance, legal, security and others), each with its own catalog, categories, groups, forms, SLAs, KB, notifications and automations on one shared people and org base; lifecycle "in setup" (published items visible only to members) → live → archived; workspace admins; a secure flag for confidential workspaces (ACC-030).
- **Implementation:** `workspace` and `workspace_member` (access data model); configuration tables carry `workspace_id`; workspace-scoped admin roles (ACC-024).

#### ADM-007 Configuration versioning, diff and rollback · نسخه‌گذاری، مقایسه و بازگردانی پیکربندی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, ITIL 4
- **Description:** Every configuration object (forms, rules, flows, SLAs, models, catalog items, templates, roles and grants) keeps versions with author, time, reason and a readable diff; drafts are separate from published versions; any version can be restored; deleted configuration goes to a configuration trash.
- **Implementation:** `config_version` rows written by the record service for configuration tables; JSON diff viewer; restore creates a new version.

#### ADM-008 Configuration simulation and test runs · شبیه‌سازی و اجرای آزمایشی پیکربندی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM
- **Description:** Before publishing, admins dry-run a configuration on real data: apply this SLA to last month's tickets and see what would have breached, run this flow on record X without side effects, see where an assignment rule would have routed recent tickets, list who would receive a notification. Results are shown next to the current version's results.
- **Implementation:** simulation mode in each engine (no writes, side effects captured) under the admin's access; results kept as `simulation_run`.

#### ADM-009 Configuration change sets and packages · مجموعه‌تغییرها و بسته‌های پیکربندی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, ManageEngine SDP, BMC Helix
- **Description:** Configuration changes are captured in named change sets (or selected afterwards with dependency resolution), exported as signed packages and imported elsewhere with a preview that detects collisions (target changed since the base), missing dependencies and identity mismatches; the admin decides per conflict, commits atomically and can back the package out. Packages use stable external IDs.
- **Implementation:** `change_set`, `change_set_item`, `package_import`; `ext_id` on configuration rows; packages signed with the tenant key.

#### ADM-010 Sandbox environments and promotion · محیط آزمایشی و انتقال به محیط اصلی
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice, JSM, ManageEngine SDP, ServiceNow
- **Description:** Create a sandbox tenant from production configuration (metadata only, anonymised sample or full copy under privacy rules), test there with access limited to admins, then promote change sets to production with the same diff, approvals and post-promotion checks; sandboxes expire unless renewed and can receive platform updates early (preview track, ADM-015).
- **Implementation:** `environment` links tenants; clone job; promotion uses ADM-009 packages; AI and integrations disabled or pointed at test endpoints by default.

#### ADM-011 Clone with data anonymisation · کپی داده با ناشناس‌سازی
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow
- **Description:** Copy production data into a sandbox with table exclusions, preserved target-specific records (credentials, endpoints) and anonymisation rules for personal and sensitive field classes (names, national IDs, phone numbers, free text with detected PII), so tests run on realistic but safe data.
- **Implementation:** clone profiles; anonymiser driven by field classes (ACC-044) and the PII classifier (ACC-049); the clone report is kept as evidence.

#### ADM-012 Configuration change control · کنترل تغییر پیکربندی
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, ISO/IEC 20000-1, SOC 2, ServiceNow
- **Description:** A tenant can require that publishing high-impact configuration (state models, SLAs, access policy, integrations, AI settings) links to an approved change record, respects change freezes and passes required tests and scans; the publish log records the change number and a report shows the share of configuration changes made under change control.
- **Implementation:** publish guard checks a linked change in an approved or implementing state; policy per configuration table.

#### ADM-013 Administration governance model · مدل حاکمیت مدیریت
- **Tier:** P1 · **AI:** no · **Sources:** ITIL v5, ITIL 4, iTop, ServiceNow
- **Description:** Per workspace or domain the tenant chooses how configuration is governed: centralised (tenant admins only), guided (local admins draft, central admins approve), federated (local admins publish within guardrails such as locked fields and mandatory SLAs) or autonomous (team-owned configuration, audited). Guardrails and approvers are explicit and visible.
- **Implementation:** `governance_model` per scope; publishing uses the approval engine; guardrails are locked properties (PLT-014).

#### ADM-014 Upgrade center and upgrade-safe customisation · مرکز ارتقا و سفارشی‌سازی ارتقاپذیر
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, Ivanti, iTop, OpenText SMAX, Freshservice
- **Description:** Before a platform version lands, an impact preview lists tenant customisations that touch changed base objects. After the upgrade, a three-way diff auto-applies objects the tenant never changed and queues the rest for review (merge, keep or revert) without silently hiding new base fields; a customisation inventory shows technical debt; smoke tests run automatically afterwards.
- **Implementation:** base/tenant layering (PLT-014); `upgrade_run`, `skipped_change`; tests from ADM-017.

#### ADM-015 Release tracks, early access, freeze windows and what's new · مسیرهای انتشار، دسترسی زودهنگام و تازه‌ها
- **Tier:** P1 · **AI:** no · **Sources:** JSM, Freshservice, TOPdesk, Znuny
- **Description:** Tenants choose a continuous, bundled (monthly) or preview (sandbox first) release track; freeze windows block visible changes in critical periods (fiscal year end, Nowruz); breaking changes are announced with dates; early access can be requested per feature; an in-app «تازه‌ها» page and contextual notes appear only where a change applies.
- **Implementation:** flags evaluated per tenant and environment (ADM-016); `release_track`, `freeze_window`; changelog entries maintained in code.

#### ADM-016 Feature flags and plan gating · کلیدهای قابلیت و محدودسازی بر پایهٔ طرح
- **Tier:** P0 · **AI:** no · **Sources:** JSM, TOPdesk, Freshservice
- **Description:** Every optional capability is switched by flags at tenant, workspace or domain level with three gates — plan, rollout stage and admin toggle — and the settings page explains why something is unavailable; flags can target named users for pilots.
- **Implementation:** `feature_flag`; the compiled flag set travels in the subject context; checked on the server and exposed to the UI.

#### ADM-017 Automated test framework · چارچوب آزمون خودکار
- **Tier:** P2 · **AI:** yes · **Sources:** ServiceNow
- **Description:** No-code tests for the tenant's configuration: create a record with given values and assert state, assignment, SLA, notification and approval outcomes; run a flow; call an API. Suites, data-driven parameters, schedules, runs before promotion and after upgrades, quick-start packs per module, and AI-generated test cases from a flow or form.
- **Implementation:** `test_suite`, `test_case`, `test_run`; runs in a sandbox or inside a transaction rolled back at the end.

#### ADM-018 Configuration scan and best-practice checks · بررسی پیکربندی و بهترین روش‌ها
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow
- **Description:** Rules inspect configuration and data — rules referencing inactive objects, flows that never ran, notifications to deactivated users, empty groups, unused roles, SLAs without calendars, risky scripts, unindexed filter fields — with category (security, performance, upgradability, manageability, UX), severity and remediation guidance; run on demand, per change set and on a schedule; findings tracked to closure.
- **Implementation:** `scan_rule` (selector + predicate or AST lint), `scan_run`, `scan_finding`.

#### ADM-019 Branding and theming · برندسازی و ظاهر
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ITIL 4
- **Description:** Logo, favicon, colour tokens, login page, e-mail layout and portal theme at tenant, workspace and domain level (MSP customers get their own branding); custom domains with automatic TLS; previews in light and dark; brand settings cannot break contrast or RTL.
- **Implementation:** tokens per scope injected as CSS variables; DNS verification of custom domains; certificates via ACME.

#### ADM-020 Localisation administration · مدیریت زبان‌ها و ترجمه
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, Ivanti, JSM, Freshservice
- **Description:** Enable languages and manage translation of UI strings and content (catalog, KB, templates, choices) through a workflow (request → translate → review → publish) with AI machine-translation drafts, a terminology glossary (for example «رخداد» rather than «حادثه»), a missing-translation report and import/export of language files.
- **Implementation:** workflow states on `translation`; AI translation skill bound to the glossary; coverage report per locale.

#### ADM-021 Data lifecycle: retention, archiving, legal hold and erasure · چرخهٔ عمر داده: نگهداشت، بایگانی و حذف
- **Tier:** P1 · **AI:** no · **Sources:** ISO/IEC 27001, GDPR, ManageEngine SDP, ServiceNow, Freshservice, ITIL 4
- **Description:** Retention policies per table and data class (trigger such as closed date or contract end, period, disposition delete/anonymise/archive); archives remain searchable for authorised users; legal holds by condition or record list block disposition; data-subject erasure anonymises a person's personal fields across records; records still referenced (a KB article used by open incidents) are archived, not deleted; every disposition run is logged as evidence.
- **Implementation:** `retention_policy`, `legal_hold`, `disposition_run`; jobs run as a system principal and record counts and hashes.

#### ADM-022 Backup and restore · پشتیبان‌گیری و بازیابی
- **Tier:** P1 · **AI:** no · **Sources:** JSM, ITIL 4, our fork
- **Description:** Scheduled and on-demand tenant backups (data, attachments, configuration) encrypted with tenant keys, with a retention policy, restore into a sandbox for inspection or into the tenant after approval, point-in-time options on self-hosted deployments and restore tests recorded as evidence; desktop installations keep automatic local backups.
- **Implementation:** `backup`, `restore_request`; logical export per tenant; restores need two approvals; RPO and RTO targets per plan.

#### ADM-023 Full data export (no lock-in) · خروجی کامل داده
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice, ITIL v5
- **Description:** Export all records, history, attachments and configuration in open formats (JSON/CSV, files and a schema description) on demand or on a schedule, so a tenant can archive or leave at any time.
- **Implementation:** `data_export_job`; streaming export per table; signed manifest.

#### ADM-024 Deployment options and data residency · گزینه‌های استقرار و محل نگهداری داده
- **Tier:** P1 · **AI:** no · **Sources:** JSM, Freshservice, ManageEngine SDP, BMC Helix, our design
- **Description:** The same product runs as multi-tenant SaaS, as a single-tenant private deployment (customer data centre or an Iranian cloud) or as a standalone desktop installation; each tenant records its region and residency; AI providers and integrations are limited to allowed regions; large tenants can get a dedicated database.
- **Implementation:** deployment profile on `tenant`; region-aware routing; a self-hosted bundle (container) of the API and Postgres; residency checks on AI connections (INT-040).

#### ADM-025 Tenant lifecycle and status · چرخهٔ عمر و وضعیت سازمان
- **Tier:** P0 · **AI:** no · **Sources:** our fork, Freshservice, JSM
- **Description:** The platform owner creates tenants, sets plan and limits and changes status (active, read-only, suspended, maintenance) with a reason; status applies to every write and to sync; deleting a tenant requires a final export and a waiting period; an owner console lists tenants with usage and health.
- **Implementation:** `tenant` (= `sm_orgs`), `tenant_status` (= `sm_org_admin`); status checked in the request context.

#### ADM-026 Subscription, licence and seat management · مدیریت اشتراک و مجوزها
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, ITIL 4
- **Description:** Licence pools by type (agent, occasional agent or day pass, business agent, external/vendor agent, admin, AI add-on), assignment through roles, consumption by role type, last activity, reclaim suggestions for idle seats and over-use warnings; requesters and approvers never consume a seat.
- **Implementation:** `licence_pool`, `seat_assignment`; a seat is consumed when a role with licence ≥ agent is assigned (ACC-026).

#### ADM-027 Usage metering and spend controls · سنجش مصرف و کنترل هزینه
- **Tier:** P1 · **AI:** no · **Sources:** JSM, Freshservice, ServiceNow, ManageEngine SDP, Atomicwork
- **Description:** Meters for AI tokens and runs (per provider and model), automation steps, integration calls, SMS segments, storage and API calls, with allowances, alerts at 50/80/90/100%, caps that block or degrade gracefully, budgets per workspace, domain, agent or user, cost in Rial and foreign currency, and CSV export.
- **Implementation:** `usage_meter`, `usage_record`, `budget`; counters updated by the consuming jobs; the forked AI usage and budget tables are reused.

#### ADM-028 AI administration center · مرکز مدیریت هوش مصنوعی
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, SysAid, TOPdesk, Alemba, ManageEngine SDP, ITIL v5, ISO/IEC 42001
- **Description:** One page for AI: provider connections (cloud and local, bring your own key), model tiers per skill (small, large, embedding, rerank, vision, speech) with fallback chains, allowed providers and regions per tenant, workspace and domain, a "no data leaves the network" mode, PII masking level, switches per skill and agent (new ones off by default), autonomy limits, budgets, kill switches (agent, tool, provider, all AI), an AI-readiness check (data quality, KB coverage) and usage/acceptance dashboards. Changes need the AI-admin permission.
- **Implementation:** scoped `ai_policy` settings plus the forked AI connection, hold and usage tables; the AI module's register (AI systems, impact assessments) links here.

#### ADM-029 System health and performance monitoring · پایش سلامت و کارایی سامانه
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, ITIL 4, JSM
- **Description:** A health dashboard per tenant and for the platform owner: API latency and error rates, slow queries, queue depth and age, job failures, integration and e-mail errors, storage growth, desktop sync lag, AI provider errors and holds; thresholds raise alerts into the event and incident modules.
- **Implementation:** middleware and jobs write `health_metric`; alert rules emit events.

#### ADM-030 Logs and diagnostics · گزارش‌های فنی و عیب‌یابی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, JSM, Freshservice
- **Description:** Searchable logs of system errors, flow runs and steps, business-rule executions, e-mail processing, notification deliveries, integration requests (secrets redacted) and AI runs, plus an access-decision debugger for a chosen user and record (ACC-089); retention per log type; export for support.
- **Implementation:** structured logs with correlation IDs; views over `flow_run_step`, `notification_log`, `integration_event`, `ai_run`; redaction at write time.

#### ADM-031 Job and schedule monitor · پایش کارهای زمان‌بندی‌شده
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, ITIL 4
- **Description:** System and tenant jobs and schedules with next and last run, duration, status, failures and dead jobs; retry, pause, resume and run-now actions; owners alerted on repeated failure.
- **Implementation:** views over `job` and `schedule`; every action audited.

#### ADM-032 Admin audit log viewer · مشاهدهٔ گزارش ممیزی مدیریت
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, ManageEngine SDP, JSM, ServiceNow, ITIL 4
- **Description:** Every configuration and administration action (who, what, before/after, when, IP, reason, support session) is searchable by object, actor, date and workspace, exportable, retained per policy and readable by auditors; it includes restricted-group approvals, sandbox promotions and AI-setting changes.
- **Implementation:** `admin_audit` (= `sm_audit`), append-only and hash-chained (PLT-030).

#### ADM-033 Usage and adoption analytics · تحلیل به‌کارگیری
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, JSM, InvGate, ServiceNow
- **Description:** Active users by persona and module, feature usage, channel mix (portal, e-mail, messengers, phone), self-service adoption, AI adoption (tried) versus engagement (kept using), and outcomes of AI-assisted versus unassisted work, so admins can plan training and rollout.
- **Implementation:** aggregated usage events; aggregate-only access for admins (ACC-050).

#### ADM-034 Platform limits and guardrails · حدود و محافظ‌های سامانه
- **Tier:** P1 · **AI:** no · **Sources:** JSM, ServiceNow
- **Description:** Documented per-tenant limits (custom fields per table, queues, flow steps per run, items per scheduled job, attachment size, API rate) with warnings near the limit and a clear explanation when something is blocked; limits adjustable by plan.
- **Implementation:** limits in the plan profile; enforced by the engines; warnings sent to admins.

#### ADM-035 Maintenance mode and system banners · حالت نگهداری و پیام‌های سامانه
- **Tier:** P1 · **AI:** no · **Sources:** JSM, ServiceNow
- **Description:** Maintenance windows announced in advance, a maintenance mode (read-only with a banner), tenant-wide or audience-targeted banners and a login message, all in Persian with Jalali times.
- **Implementation:** `system_banner`, `maintenance_window`; read-only mode reuses the tenant status.

#### ADM-036 Desktop client fleet and update management · مدیریت نسخه‌های ویندوز و به‌روزرسانی
- **Tier:** P1 · **AI:** no · **Sources:** our fork, JSM, ServiceNow
- **Description:** Registered desktop clients with version, last sync, time offline and health; update channels (stable, beta), minimum supported version, staged rollout, signed installers from a self-hostable mirror and forced updates for security fixes.
- **Implementation:** `client_release` plus the device registry (ACC-056); the auto-updater checks the tenant's mirror.

#### ADM-037 Help and guidance administration · مدیریت راهنما و نکته‌ها
- **Tier:** P2 · **AI:** no · **Sources:** HaloITSM, WCAG 2.2
- **Description:** Admins relabel, relink or hide help entries, add tenant help pages, define field hints shown on hover and short in-app guides for new staff; help sits in the same place on every page.
- **Implementation:** `help_link`, `field_hint`; rendered by the shell.

### Data model

Administration tables hold configuration and operational metadata; they are readable by the admin roles of their scope (tenant, workspace or domain) and always audited. Tenant isolation follows `org_id`; MSP scopes add `domain_id`.

| Table | Key fields | States (category) | Prefix | Relationships | Access scoping |
|---|---|---|---|---|---|
| `tenant` (= `sm_orgs`) | slug, name, plan, region, deployment (saas/private/desktop), kms_key_ref, msp_mode, policy_version, product_name | — | — | workspaces, domains | platform owner; tenant admins read |
| `tenant_status` (= `sm_org_admin`) | status, reason, set_by, until | active, read_only (waiting), suspended (waiting), maintenance (waiting), deleted (closed) | — | tenant | platform owner |
| `setting` | key, scope (tenant/workspace/domain/user), scope_id, value, version, updated_by | — | — | — | admins of the scope; user scope: own |
| `feature_flag` | key, scope, scope_id, state, rollout_stage, plan_gate, pilot_users | off, beta, on | — | — | plan and rollout: platform owner; toggle: tenant admin |
| `config_version` | object_table, object_id, version, payload, diff, author_id, change_set_id, ai_run_id, comment | draft (new) → published (active) → superseded (closed) | — | any configuration object | same as the object |
| `change_set`, `change_set_item` | name, environment_id, change_request_id, owner_id / object ref, action, payload, base_version | in_progress (active) → complete (resolved) → committed (closed); backed_out (canceled) | CS | change request (change module) | owner + config admins |
| `package_import` | source_env, package_hash, signature, conflicts, decisions | uploaded (new) → previewed (waiting) → committed (closed); backed_out (canceled) | PKG | change sets | config admins |
| `environment` | kind (production/sandbox/test/training), tenant_id, parent_tenant_id, data_mode, expires_at, members | active, expired (closed) | — | tenants | tenant admins; sandbox members |
| `simulation_run` | object ref, version, dataset_filter, results | done | — | configuration version | the admin who ran it |
| `governance_model` | scope, mode, approvers, guardrails | — | — | workspace or domain | tenant admins |
| `upgrade_run`, `skipped_change` | from_version, to_version, stats / object ref, base_old, base_new, tenant_version, resolution, reviewer_id | run: scheduled (new) → running (active) → review (waiting) → completed (closed) / rolled_back (canceled); change: open (new) → merged, kept, reverted (closed) | UPG | configuration objects | config admins |
| `release_track`, `freeze_window` | track / start_at, end_at, reason | — | — | tenant | tenant admins |
| `test_suite`, `test_case`, `test_run` | name, steps, parameters / suite_id, trigger, results | queued (new) → running (active) → passed, failed (closed) | TST | configuration objects | config admins |
| `scan_rule`, `scan_run`, `scan_finding` | selector, predicate, category, severity / object ref, rule_id, details, owner_id | open (new) → in_progress (active) → fixed (resolved) → closed; accepted_risk (closed); false_positive (canceled) | SCN | configuration objects | config admins; finding owner |
| `content_pack`, `content_pack_install` | key, version, publisher, signature, items / pack_id, scope, installed_version | installed (active) → removed (closed) | — | configuration objects | tenant or workspace admins |
| `onboarding_task` | checklist_key, step, scope, completed_by, completed_at | open (new) → done (closed) | — | — | admins of the scope |
| `retention_policy`, `legal_hold`, `disposition_run` | table or class, trigger_field, period, disposition / scope_cond, record_ids, reason, case_ref / policy_id, counts, hash | hold: active → released (closed); run: running (active) → done (closed) / failed (canceled) | LH, DSP | records | data-admin role; hold owner; auditors read |
| `backup`, `restore_request` | kind, scope, size, location, key_ref, retention_until / backup_id, target, approvals | backup: running (active) → completed (closed) / failed (canceled); restore: requested (new) → approved (waiting) → running (active) → done (closed) / rejected (canceled) | BKP, RST | tenant | data admins; restores need two approvers |
| `data_export_job` | scope, formats, include_attachments, manifest_hash | queued (new) → running (active) → ready (closed) → expired (closed) | DEX | tenant | tenant admins with export elevation |
| `licence_pool`, `seat_assignment` | type, quantity, valid_to / user_id, pool_id, assigned_at, last_active_at | — | — | users, roles | tenant admins; users see their own |
| `usage_meter`, `usage_record`, `budget` | key, allowance, period, cap, thresholds / meter_id, period, quantity, cost, dims (provider, model, workspace, domain, user, agent) / scope, meter, limit, action | — | — | — | tenant admins and budget owners; users see their own AI usage |
| `ai_policy` | scope, allowed_providers, regions, local_only, pii_mode, skill_switches, autonomy_limits, model_tiers | — | — | `ai_connection`, AI skills | AI admins |
| `health_metric` | metric, scope, ts, value | — | — | — | platform owner; tenant admins for their tenant |
| `system_banner`, `maintenance_window` | kind, audience_id, message, severity, start_at, end_at | scheduled (new) → active → ended (closed) | — | audiences | tenant admins, platform owner |
| `client_release` | platform, version, channel, min_supported, notes, file_ref, signature | draft (new) → released (active) → withdrawn (canceled) | — | devices | platform owner; tenant admins pick the channel |
| `admin_audit` (= `sm_audit`) | actor_id, actor_kind, action, object ref, before, after, ip, user_agent, reason, support_session_id, at, prev_hash, hash | append-only | — | any object | auditors, security admins |
| `help_link`, `field_hint` | key, label, url, audience_id / table_key, field, text | — | — | — | config admins |

### KPIs

| KPI | Formula | Source |
|---|---|---|
| Configuration changes under change control | configuration publishes linked to an approved change ÷ configuration publishes | ITIL 4 (admin KPIs) |
| Configuration change success rate | publishes not rolled back or hot-fixed within 7 days ÷ publishes | ITIL 4 |
| Customisation trend | number of tenant overrides of base objects at period end, by category | ITIL 4 |
| Upgrade lead time | upgraded_at − version_available_at | ITIL 4 |
| Skipped-change backlog | open skipped changes after an upgrade; median age | ServiceNow (upgrade review) |
| Admin request backlog | open requests in the administration category; median age | ITIL 4 |
| Policies reviewed on time | policies reviewed by their due date ÷ policies due | ITIL 4, ISO/IEC 20000-1 |
| Scheduled-job failure rate | failed scheduled runs ÷ scheduled runs | ITIL 4 |
| Promotion lead time | production commit time − change-set completion time | our design |
| Pre-promotion test pass rate | passed test runs ÷ test runs executed before promotion | ServiceNow (ATF practice) |
| Scan findings | open findings by severity; mean time from finding to fix | ServiceNow (Instance Scan) |
| Seat utilisation | seats with activity in the last 30 days ÷ assigned seats | ITAM shelfware formula |
| AI spend against budget | AI cost in period ÷ AI budget; AI cost per AI-assisted resolution = AI cost ÷ resolutions with AI assistance | AI research (metering) |
| Metered usage | consumption ÷ allowance, per meter | JSM, Freshservice |
| Backup and restore assurance | successful backups ÷ scheduled backups; successful restore tests ÷ restore tests; achieved RPO = longest gap between successful backups; achieved RTO = restore finished − restore started | ISO 22301, JSM |
| Time to first value | first resolved record − tenant creation | our design |
| Adoption | weekly active users ÷ licensed users; self-service share = records opened via portal or messengers ÷ records opened | ITIL 4, KCS |
| AI engagement | users who used AI in ≥ 3 of the last 4 weeks ÷ users who ever tried AI | InvGate |

### Beyond the market

- **One codebase, four deployments.** SaaS, Iranian cloud, on-premises and a standalone desktop installation run the same product and can move between each other with a full export; no studied tool offers a standalone desktop ITSM.
- **Ready Persian content.** ITIL-aligned Persian content packs, Iranian calendars and workspace templates install in minutes; the AI configuration assistant turns a Persian description into reviewable drafts in the normal designers.
- **Operations that survive sanctions and outages.** Self-hosted update mirrors for server and desktop, offline licence files and no dependency on foreign SaaS for core functions.
- **AI cost in Rial.** Spend per provider, model, team and user, with budgets and a "local models only" switch.
- **Calendar-aware release management.** Freeze windows and release tracks that know Nowruz and the fiscal year end in Esfand.
- **Governance patterns as configuration.** ITIL v5's directive, guided, federated and autonomous governance patterns become an explicit setting per workspace or domain, which no tool exposes.

## Module: integration — یکپارچه‌سازی و اتصال‌ها

### Features

#### INT-001 Uniform record REST API generated from metadata · API یکپارچهٔ REST برای همهٔ جدول‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, BMC Helix, ITIL 4
- **Description:** Every table gets the same endpoints: list/query (condition AST or simple parameters), get, create, update with revision, transition, delete, journal, history, links, watchers, attachments, aggregate, bulk, export and import; field selection, display values, keyset pagination, Persian error messages, an OpenAPI 3.1 document generated from the registry (including tenant custom fields) and a browsable API explorer. The API runs under the caller's identity with the same access predicate, field masks and rules as the UI.
- **Implementation:** `/api/o/:org/r/:table…` on Hono; zod schemas generated from `TableDef`s; versioned path; OpenAPI served per tenant.

#### INT-002 Module service APIs · APIهای خدماتی ماژول‌ها
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice
- **Description:** Task-level APIs that wrap business logic: order a catalog item with variables, approve or reject, check change conflicts and risk, search knowledge with audiences applied, read SLA timers, identify-and-reconcile a CI, declare a major incident; documented and versioned with each module.
- **Implementation:** modules register service routes with the same authentication, rate limits and audit as the record API.

#### INT-003 API authentication and app registrations · احراز هویت API و ثبت برنامه‌ها
- **Tier:** P0 · **AI:** no · **Sources:** JSM, ServiceNow, Freshservice, OAuth 2.1, RFC 8693, MCP authorization spec
- **Description:** Personal API tokens (scoped, expiring, inheriting the user's rights); app registrations for third-party apps (authorization code + PKCE with a Persian consent screen); client credentials and mutual TLS for integration principals; JWT bearer for server-to-server trust; token exchange so an integration acting for a user gets an audience-bound token with exactly that user's rights. Scopes map to areas and actions.
- **Implementation:** OAuth 2.1 authorization server inside the API; `api_client`, `api_token` (= `sm_api_keys`), `oauth_grant`; tokens hashed at rest; governance in ACC-080.

#### INT-004 Rate limits, quotas and idempotency · محدودیت نرخ، سهمیه و یکتاسازی درخواست
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM
- **Description:** Token-bucket limits per token, user, integration and tenant with `429` and `Retry-After`; daily quotas per plan; idempotency keys on create endpoints and inbound webhooks so retries never duplicate records; request-size limits and cost weights for expensive queries.
- **Implementation:** middleware counters; idempotency table caching responses for 24 hours.

#### INT-005 Outbound webhooks and event subscriptions · وب‌هوک خروجی و اشتراک رویداد
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4, JSM, ManageEngine SDP, GLPI, Zammad, NetBox, Freshservice
- **Description:** Subscriptions to record events (filtered by table and condition) deliver JSON payloads signed with HMAC; payloads contain only records and fields the subscriber's identity may read; retries with exponential backoff, a dead-letter queue with replay, automatic pause after repeated failures, delivery history, "send a test with a real record" and encrypted secret headers.
- **Implementation:** `webhook_subscription`, `webhook_delivery` fed by the outbox; projection under the subscriber principal (ACC-080).

#### INT-006 Inbound webhooks and event API · وب‌هوک ورودی و API رویداد
- **Tier:** P0 · **AI:** no · **Sources:** JSM, ServiceNow, Freshservice, Znuny
- **Description:** Token- or HMAC-verified endpoints accept payloads from monitoring tools, CI/CD, forms or partners and map them to records (create or update by correlation key) or start flows; schema validation, an idempotency window, a request log with payload preview and replay, and a principal that limits what each endpoint may do.
- **Implementation:** `inbound_endpoint` (token, mapping, target, principal); processing in jobs; JSON-path mapping.

#### INT-007 Connection and credential store · مخزن اتصال‌ها و اعتبارنامه‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, ManageEngine SDP, our fork
- **Description:** Named connections per environment, workspace or domain hold the endpoint, the auth method and a credential (basic, API key, OAuth client or per-user OAuth tokens, SSH key, certificate, mutual TLS) encrypted per tenant and never shown again; optional retrieval from an external vault (HashiCorp Vault, CyberArk); test button, health status, rotation reminders and an owner. Flows and AI tools reference the connection, never the secret.
- **Implementation:** `connection` (= `sm_integrations`), `credential`; envelope encryption with tenant keys; secrets decrypted only inside job handlers.

#### INT-008 Connector framework with typed actions · چارچوب رابط‌ها با اقدام‌های نوع‌دار
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, ManageEngine SDP, HaloITSM
- **Description:** A connector is a versioned bundle of typed actions (inputs, outputs, risk class, required permission) and triggers over a connection. A generic HTTP action (methods, headers, body templates, JSON-path outputs, paginated streams for large results, timeouts, allowlisted hosts) covers systems without a ready connector. Actions are usable from flows, catalog fulfilment, AI agents and the relay.
- **Implementation:** `connector`, `connector_action`; HTTP calls only from jobs; per-tenant host allowlist; every call logged (INT-010).

#### INT-009 OpenAPI-to-connector generator · ساخت رابط از روی OpenAPI
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, ManageEngine SDP, Freshservice
- **Description:** Import an OpenAPI/Swagger document or a Postman collection and generate typed actions with authentication, pagination and response mapping; AI proposes Persian names, descriptions and field mappings and flags risky operations (deletes, payments) for approval policies.
- **Implementation:** the generator writes draft `connector_action` rows that are reviewed and published like other configuration.

#### INT-010 Integration logs, monitor and dead-letter replay · گزارش، پایش و بازپخش یکپارچه‌سازی
- **Tier:** P0 · **AI:** no · **Sources:** HaloITSM, ServiceNow, Freshservice, ITIL 4
- **Description:** Every inbound and outbound call is logged with request and response (secrets redacted), latency, status and correlation ID, visible per run step; a monitor shows health, throughput, error rate and queue age per connection and raises alerts into the event module; failed messages go to a dead-letter queue where they can be inspected, corrected and replayed.
- **Implementation:** `integration_event` (= `sm_integration_events`), `dead_letter`; retention per tenant; health computed by jobs.

#### INT-011 Field mapping and external reference store · نگاشت فیلدها و مرجع شناسه‌های بیرونی
- **Tier:** P0 · **AI:** no · **Sources:** BMC Helix, ITIL 4, ManageEngine SDP, Znuny
- **Description:** Reusable mapping sets between local and remote fields with value maps (states, priorities, categories), direction and field ownership (which side wins), versioned like configuration; a cross-reference of local and remote IDs and numbers per connection; every write carries its source integration so update loops cannot form.
- **Implementation:** `field_mapping`, `external_ref`; `origin` stamp on writes; mapping editor tested against sample payloads.

#### INT-012 Master data ownership and authoritative sources · مالکیت داده‌های پایه و منابع معتبر
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, SIAM BoK
- **Description:** Declare per object and field which system is authoritative (people and org → HR or IdP, locations → facilities, CIs → discovery, services → service catalogue, suppliers and contracts → procurement/ERP, costs → finance); local edits to source-owned fields are blocked or flagged, and conflicts show both values with source and time for data stewards.
- **Implementation:** `master_data_source`; write guard in the record service; conflict queue.

#### INT-013 Directory connectors (AD/LDAP, Entra ID, Okta, Google) · رابط‌های فهرست کاربران
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, GLPI, Freshservice, Ivanti, JSM
- **Description:** Scheduled and incremental sync of users, groups, org units, managers, titles, phones and photos from on-premises Active Directory/LDAP (very common in Iranian organisations), FreeIPA, Microsoft Entra ID, Okta and Google Workspace, with attribute mapping (including Persian name attributes), group filters, deactivation of removed accounts and a preview before the first run; on-premises directories are reached through the relay.
- **Implementation:** directory connector with delta tokens; feeds the JML automation (ACC-077) and attribute-based assignment rules (ACC-078).

#### INT-014 HR system connectors · رابط سامانه‌های منابع انسانی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ITIL 4
- **Description:** HR systems as the authoritative source for people, positions, org units, managers and employment status; hire, transfer and termination events start onboarding and offboarding journeys and the access changes of ACC-077; Workday, SAP SuccessFactors and Iranian HR/payroll systems through the connector framework or file drops.
- **Implementation:** HR connector emitting effective-dated person and org events processed on their effective date.

#### INT-015 Mailbox connectivity · اتصال صندوق‌های ایمیل
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, JSM, Znuny, BMC Helix, ManageEngine SDP
- **Description:** Several mailboxes per workspace over IMAP/SMTP, Microsoft 365 (Graph with OAuth2), Gmail (OAuth) or on-premises Exchange; sender identities, DKIM/SPF/DMARC checks and guidance, size limits and polling status; outbound SMTP with TLS and correct Persian subject encoding.
- **Implementation:** `mailbox`; IMAP via imapflow, Graph via REST; polling jobs per mailbox; credentials in INT-007.

#### INT-016 SMS gateways · درگاه‌های پیامک
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, ManageEngine SDP, JSM, our design
- **Description:** Adapters for Iranian SMS providers (for example Kavenegar, Ghasedak, SMS.ir, Magfa) and a generic HTTP template for any gateway: notifications, one-time codes for sign-in and approvals, delivery reports, Persian Unicode segmentation with a cost estimate, sender lines per workspace, opt-out handling and inbound replies (for example «۱» to approve) where the provider supports them.
- **Implementation:** `sms_gateway`, `sms_message`; metering per segment (ADM-027); retries with a fallback gateway.

#### INT-017 Messenger notification channels · کانال‌های اعلان در پیام‌رسان‌ها
- **Tier:** P0 · **AI:** no · **Sources:** our design, JSM, ServiceNow, Freshservice
- **Description:** Notifications delivered to Bale, Eitaa, Soroush Plus, Rubika, Telegram, Mattermost, Rocket.Chat or any webhook-capable messenger, to people who linked their account with a one-time code or to group channels; messages carry deep links and follow the same per-recipient access and field masks as e-mail.
- **Implementation:** `messenger_channel`, `messenger_identity`; channel adapters in the notification engine; bot tokens in the credential store.

#### INT-018 Messenger and chat bots for intake and approvals · ربات پیام‌رسان برای ثبت درخواست و تأیید
- **Tier:** P1 · **AI:** yes · **Sources:** JSM, Freshservice, ServiceNow, Atomicwork, our design
- **Description:** Bots in Bale, Telegram, Teams, Slack and Mattermost let people raise requests in a Persian conversation, attach photos, check status, answer agents' questions, approve or reject with buttons and get knowledge answers from the AI assistant; agents can reply from the messenger choosing internal or public. The linked account is the identity, so every action runs under that user's permissions.
- **Implementation:** bot webhook handlers per platform; conversational intake by the AI virtual agent with a deterministic form fallback; approval buttons carry signed one-time tokens.

#### INT-019 Collaboration platform integration · یکپارچگی با سکوهای همکاری
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, JSM, BMC Helix, Freshservice, ITIL 4
- **Description:** For Teams, Slack, Mattermost and Rocket.Chat: create a channel per major incident with its responders, post updates, run ChatOps commands, capture the channel transcript back into the record and give late joiners an AI summary; notifications and approvals as in INT-017 and INT-018.
- **Implementation:** platform apps with OAuth; transcripts imported as `discussion_message`; summary skill from the AI module.

#### INT-020 Voice and telephony (CTI) · تلفن و مرکز تماس
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, ManageEngine SDP, JSM, ITIL 4, our design
- **Description:** CTI with Asterisk/Issabel and SIP providers used in Iran: screen pop with caller identification, click-to-call from records, call logs with recording links, IVR menus that create or look up tickets, voice notifications for on-call escalation, and AI transcription and summary of calls into the work notes.
- **Implementation:** AMI/ARI or SIP webhook adapters; `call_log`; speech-to-text through the tenant's AI provider or a local model.

#### INT-021 Video conference bridges · پل‌های ویدئوکنفرانس
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, JSM, BMC Helix, our design
- **Description:** Start a bridge for a major incident or CAB meeting from the record (Skyroom, BigBlueButton, Jitsi, Teams, Zoom, Google Meet), invite the responders and link the recording and attendance back to the record.
- **Implementation:** meeting connectors with create and end actions; links stored on the record.

#### INT-022 Calendar integration · یکپارچگی تقویم
- **Tier:** P1 · **AI:** no · **Sources:** ManageEngine SDP, JSM, Freshservice, Ivanti
- **Description:** Two-way sync with Exchange/Microsoft 365 and Google calendars for change windows, CAB meetings, on-call shifts, leave and technician appointments; read-only iCal feeds with Jalali titles for saved calendar views, so unlicensed staff can follow the change schedule; leave entered in the calendar feeds out-of-office delegation (ACC-063).
- **Implementation:** `calendar_link`; Graph and Google APIs; iCal endpoint protected by a per-view secret token.

#### INT-023 Monitoring and observability event ingestion · دریافت رویداد از ابزارهای پایش
- **Tier:** P1 · **AI:** no · **Sources:** JSM, ServiceNow, BMC Helix, ManageEngine SDP, ITIL 4
- **Description:** Adapters for Zabbix, Prometheus Alertmanager, Grafana, Nagios/Icinga, PRTG, SolarWinds, Elastic, Datadog, Dynatrace and New Relic, plus a generic event API, e-mail parsing and SNMP traps through the relay; events are normalised (source, node, metric, severity, CI hint) and handed to the event module for correlation, with two-way acknowledgement where the tool supports it.
- **Implementation:** inbound endpoints with per-tool mappings; normalised event contract owned by the event module.

#### INT-024 Endpoint management, discovery and inventory connectors · رابط مدیریت نقاط پایانی و موجودی
- **Tier:** P1 · **AI:** no · **Sources:** JSM, ServiceNow, Freshservice, ManageEngine SDP, GLPI, InvGate
- **Description:** Import devices, software and users from Microsoft Intune, ConfigMgr, Jamf, Lansweeper, ManageEngine Endpoint Central, GLPI/OCS agents and antivirus consoles (Kaspersky, ESET) into the CMDB and ITAM pipeline with source precedence; push actions back to endpoints (install software, lock device) where supported.
- **Implementation:** connectors produce batches for the cmdb module's identify-and-reconcile pipeline; scheduled delta pulls.

#### INT-025 Security tool integrations · یکپارچگی با ابزارهای امنیتی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, ManageEngine SDP, BMC Helix, JSM, NIST CSF 2.0
- **Description:** SIEM/SOAR (Splunk, QRadar, Wazuh, Elastic Security), EDR (Defender, CrowdStrike, Kaspersky), vulnerability scanners (Tenable, Qualys, OpenVAS) and threat-intelligence feeds (STIX/TAXII) create or update security incidents and vulnerabilities and receive status back; payloads are classified on intake (ACC-032).
- **Implementation:** connectors and inbound endpoints mapped to the security module's tables; classification set at intake.

#### INT-026 DevOps and ALM integrations · یکپارچگی با ابزارهای DevOps
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, BMC Helix
- **Description:** GitHub, GitLab, Gitea, Azure DevOps, Jira Software and Jenkins: create or link issues from incidents and problems, sync status and comments, receive commits, builds and deployments as events linked to changes and releases, and gate pipelines on change approval.
- **Implementation:** connector actions and inbound webhooks; `external_ref` per linked item; gating through approval callbacks.

#### INT-027 Cloud provider integrations · یکپارچگی با ارائه‌دهندگان ابر
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, our design
- **Description:** AWS, Azure, GCP and Iranian clouds with APIs (for example ArvanCloud, Abr Derak, ParsPack): import resources and costs, receive alerts and run actions (start/stop a VM, create resources from catalog requests) under least-privilege credentials.
- **Implementation:** connectors mapping cloud inventory to CMDB classes; private endpoints reached through the relay.

#### INT-028 E-bonding and ticket federation · تبادل دوطرفهٔ تیکت با سامانه‌های دیگر
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, BMC Helix, ManageEngine SDP, ITIL 4, SIAM BoK, Xurrent
- **Description:** Bi-directional exchange of incidents, requests, problems and changes with suppliers, customers and other ITSM/CRM tools (ServiceNow, JSM, Freshservice, SDP, BMC, Zendesk, Znuny/OTRS, GLPI): field and state mapping, correlation IDs (local and remote numbers), acknowledgement and retry, field-ownership rules, attachment sync with hash dedupe, SLA/UC pause and resume on hand-off, the partner's reference shown on the record and a data-exchange agreement per partner.
- **Implementation:** `federation_partner`, `field_mapping`, `external_ref`; loop prevention through `origin`; a per-partner principal limits what is shared.

#### INT-029 On-premises relay agent · عامل واسط درون‌سازمانی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, InvGate, our design
- **Description:** A small service — or the Windows desktop app in relay mode — inside the customer network keeps an outbound-only HTTPS connection, long-polls a job queue and runs jobs that need local reach: LDAP/AD sync, PowerShell, SSH, WinRM, SQL, SNMP, internal REST APIs, file shares and discovery. Local credentials stay on the agent; agents form clusters with leases and failover, upgrade themselves from signed packages and post results back to the job.
- **Implementation:** `relay_agent`, `relay_job`; mutual-TLS identity per agent; routing by capability and IP range; leases with heartbeat and requeue on timeout.

#### INT-030 Remote execution and orchestration actions · اجرای راه‌دور و ارکستراسیون
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, JSM, Ivanti, Atera, ITIL 4
- **Description:** Ready actions for PowerShell, SSH, WinRM, SQL, SNMP get/set, Ansible job templates and cloud runbooks, executed through the relay, with approvals for high-risk actions, output captured on the record and compensation steps on failure; used by request fulfilment, change implementation and AI remediation proposals.
- **Implementation:** actions declare risk class and required approval (the AI tool policies of ACC-086 apply when AI proposes them); outputs redacted.

#### INT-031 Identity and account orchestration actions · اقدام‌های خودکار حساب و دسترسی
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice, ManageEngine SDP, JSM, HaloITSM, Atomicwork
- **Description:** Actions to create, enable, disable and move AD, Entra ID, Google and Okta accounts, reset passwords and unlock accounts after identity verification, and manage group memberships, mailboxes and licences; used by onboarding and offboarding, access requests (ACC-093) and self-service password reset, with every action recorded on the request.
- **Implementation:** directory connector actions through the relay or cloud APIs; verification step (OTP, manager approval) before sensitive actions.

#### INT-032 RPA and AI web agent · ربات نرم‌افزاری و عامل وب هوشمند
- **Tier:** P2 · **AI:** yes · **Sources:** ServiceNow, Ivanti, ITIL 4
- **Description:** For systems without APIs (legacy government portals, internal web apps): recorded browser automations or an AI web agent that drives the UI with a dedicated least-privilege account, with screenshots logged and human approval before anything is submitted.
- **Implementation:** headless browser runner on the relay; the web agent is an AI tool with risk class "external"; every step logged.

#### INT-033 External data look-ups for fields · جست‌وجوی دادهٔ بیرونی برای فیلدها
- **Tier:** P1 · **AI:** no · **Sources:** JSM, Freshservice, ManageEngine SDP
- **Description:** Fields and catalog variables load choices from, or validate values against, an external REST API or SQL source (cost centres from ERP, projects, contract numbers) with caching, timeouts, a fallback list and ID/label mapping; usable in forms, rules and flows.
- **Implementation:** `data_lookup` (connection, query, cache TTL, mapping); executed on the server with the caller's context.

#### INT-034 BI and data-warehouse export with row-level security · خروجی تحلیلی و انبار داده با امنیت سطری
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, JSM, ManageEngine SDP, BMC Helix
- **Description:** Scheduled extracts or change-data-capture streams to a warehouse (Postgres, ClickHouse, SQL Server) and connectors for Power BI, Metabase and Superset that always run under a named principal's predicate and field masks; unpermissioned data shares are not offered; metric definitions travel with the data.
- **Implementation:** `export_stream` (target, tables, principal, cursor); CDC from the outbox; projection per stream.

#### INT-035 Event streaming · جریان رویداد با صف پیام
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, ITIL 4
- **Description:** Publish record events to Kafka, NATS or RabbitMQ topics and consume high-volume streams (telemetry, discovery) for very large tenants, with the same per-subscriber filtering as webhooks.
- **Implementation:** outbox relay to brokers; one consumer group per subscription.

#### INT-036 Zero-copy virtual tables · جدول‌های مجازی روی پایگاه‌دادهٔ بیرونی
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow
- **Description:** Expose an external database table (ERP, warehouse) as a read-only virtual table usable in lists, reports, flows and AI tools without copying data, with filter and projection push-down, TTL caching and our row and field permissions applied on top.
- **Implementation:** remote-table definitions in the registry; push-down through foreign data wrappers or connector queries.

#### INT-037 Instance-to-instance replication · همانندسازی بین استقرارها
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, our design
- **Description:** Replicate selected tables between two deployments of the product (a holding company's on-premises instance and a subsidiary's cloud tenant, or production and a reporting replica) with producer/consumer sets, filters and a conflict policy.
- **Implementation:** the sync protocol with a server principal acting as the client; scopes per replication set.

#### INT-038 Our MCP server · سرور MCP محصول
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, Xurrent, TOPdesk, ManageEngine SDP, InvGate, JSM, Freshservice, MCP authorization spec
- **Description:** External AI clients (Claude, ChatGPT, Copilot, Cursor, local agents) connect to a Model Context Protocol server exposing permission-checked tools and resources: search and read records, search knowledge, create proposals for incidents, requests and comments, order catalog items and read SLA status. OAuth 2.1 with audience-bound per-user tokens the user can revoke, read-only by default, writes as proposals or under the user's explicit approval policy, the AI-channel policy enforced on every call and the same audit as native agents.
- **Implementation:** MCP over streamable HTTP in the Hono app; tools generated from the registry and module tool definitions; tokens from INT-003; rate limits per token.

#### INT-039 MCP client and agent interoperability · کلاینت MCP و تعامل با عامل‌های دیگر
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, HaloITSM, BMC Helix, ManageEngine SDP
- **Description:** Our agents can call tools on approved external MCP servers and exchange tasks with external agents (A2A); admins approve each server, choose which of its tools are allowed and set risk and approval policies; every call passes an AI gateway that logs it, applies data-loss rules and can block it.
- **Implementation:** `mcp_client_server` registry; gateway middleware; external tools inherit the policy model of ACC-086.

#### INT-040 AI model provider connectors · رابط ارائه‌دهندگان مدل هوش مصنوعی
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow, ManageEngine SDP, BMC Helix, Zammad, our fork
- **Description:** Tenants bring their own models: OpenAI-compatible services, Anthropic, Gemini, Azure OpenAI, AWS Bedrock, Iranian-hosted model services and local servers (Ollama, vLLM, LM Studio). Each connection stores the base URL, an encrypted key, models with a probed capability matrix (tools, JSON mode, vision, embeddings, speech, context length), region and residency, price per token, health and temporary holds after errors; the desktop uses cloud connections through the relay without ever receiving keys.
- **Implementation:** `ai_connection` (= `sm_ai_connections`), `ai_hold`; capability self-test on save; the AI module's router reads the capability matrix.

#### INT-041 External knowledge connectors for RAG · رابط منابع دانش بیرونی برای RAG
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow, JSM, Freshservice, Moveworks, Glean, BMC Helix
- **Description:** Index SharePoint, Confluence, Google Drive, Nextcloud, file shares and websites for AI answers and search. The connector captures each item's permissions and maps them to our principals, syncs changes incrementally within a stated freshness window, fails closed when permission sync is late, and lets admins choose which sources each assistant may use; an optional live mode queries the source with the user's own OAuth token.
- **Implementation:** `knowledge_source`; chunks carry mapped access keys (ACC-084); delta cursors and periodic full re-sync.

#### INT-042 Migration from other ITSM tools · مهاجرت از ابزارهای دیگر
- **Tier:** P1 · **AI:** no · **Sources:** JSM, ITIL 4, our design
- **Description:** Migration kits for Znuny/OTRS, GLPI, iTop, Zammad, ServiceNow, JSM, Freshservice, ManageEngine SDP and spreadsheets: mapping templates for people, groups, categories, tickets with full history and attachments, KB, CIs and assets; a trial migration into a sandbox, delta migration before cut-over, number-preserving options and a reconciliation report.
- **Implementation:** `migration_project` (MIG); source readers over APIs or database dumps; loads through the import framework with `origin = migration` and preserved history.

#### INT-043 Iranian enterprise system connectors · رابط سامانه‌های سازمانی ایرانی
- **Tier:** P2 · **AI:** no · **Sources:** our design (Persian context)
- **Description:** Connectors for systems Iranian organisations run: office automation and correspondence (for example Didgah, Chargoon) to register and track official letters linked to requests; ERP and finance suites (for example Rahkaran, Hamkaran, Sepidar, Tadbir) for cost centres, purchasing and asset capitalisation; HR and payroll systems; on-premises reach through the relay.
- **Implementation:** connector packages per product; letter numbers stored as external references.

#### INT-044 ERP, procurement and finance connectors · رابط ERP، تدارکات و مالی
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, ITIL 4, Freshservice
- **Description:** SAP, Oracle, Microsoft Dynamics and Odoo: purchase requisitions and orders from catalog requests, goods receipt to assets, invoices to contracts, cost centres and budgets to financial management.
- **Implementation:** connector packages mapped to procurement and financial module tables.

#### INT-045 Digital signature and e-signature integration · یکپارچگی امضای دیجیتال
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, our design
- **Description:** Sign approvals, hand-over forms and policies with qualified digital signatures (national PKI tokens and certificates) or e-signature services (DocuSign, Adobe Sign), storing the signed PDF and the verification result on the record.
- **Implementation:** signing through the desktop app (token access) or a signing-service API; verification job.

#### INT-046 Maps and geocoding · نقشه و مکان‌یابی
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, ITIL 4, our design
- **Description:** Geocode locations and sites, show records and technicians on a map, compute travel times for field work and capture GPS on mobile updates, using Neshan, Balad or OpenStreetMap.
- **Implementation:** map-provider connector; coordinates on `location`; configurable tile provider.

#### INT-047 Remote support tool integration · یکپارچگی با ابزارهای پشتیبانی راه‌دور
- **Tier:** P2 · **AI:** no · **Sources:** ManageEngine SDP, BMC Helix, Atera
- **Description:** Start a remote session (self-hosted RustDesk, AnyDesk, TeamViewer, Endpoint Central) from a ticket or asset, with the session link, duration and recording reference logged on the record.
- **Implementation:** connector actions; session logs as journal entries.

#### INT-048 Survey tool connectors · رابط ابزارهای نظرسنجی
- **Tier:** P2 · **AI:** no · **Sources:** BMC Helix, ManageEngine SDP, our design
- **Description:** Send surveys through external tools (Porsline, Google Forms, HappySignals) and import the responses into survey results linked to records.
- **Implementation:** connector actions and an inbound webhook for responses.

#### INT-049 Extension framework and marketplace · چارچوب افزونه و بازارچه
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, JSM, Freshservice, ManageEngine SDP, GLPI, iTop, EasyVista
- **Description:** Packaged extensions (connectors, UI panels on record pages, serverless handlers, content packs) declare the permissions they need; tenant admins review and approve those permissions on install and can enable, disable and update them; private extensions per tenant and a curated catalogue.
- **Implementation:** `extension`, `extension_install`; sandboxed handlers (PLT-050); an extension principal holding only the declared grants.

#### INT-050 Standard interoperability models · مدل‌های استاندارد تبادل داده
- **Tier:** P2 · **AI:** no · **Sources:** IT4IT, TM Forum Open APIs, SCIM 2.0, OSLC
- **Description:** Optional mappings of our records to IT4IT data objects and TM Forum Open API resources (trouble ticket, service order), so partners that use those standards integrate without custom mapping.
- **Implementation:** ready mapping sets and endpoints built on INT-011.

#### INT-051 External iPaaS and automation platforms · سکوهای یکپارچه‌سازی بیرونی
- **Tier:** P1 · **AI:** no · **Sources:** BMC Helix, Xurrent, Ivanti, Freshservice, ManageEngine SDP, our design
- **Description:** Ready triggers and actions for n8n (self-hostable, popular where SaaS is restricted), Zapier, Make, Workato and Power Automate, built on webhooks and the REST API with OAuth apps, so teams can connect long-tail systems without code.
- **Implementation:** published app definitions per platform; an n8n community-node package.

#### INT-052 Legacy protocols and file transfer · پروتکل‌های قدیمی و انتقال فایل
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow, Znuny, BMC Helix
- **Description:** A SOAP provider and requester for legacy systems and government service buses, scheduled file drops over SFTP or SMB (CSV, XML) and CSV over e-mail, mapped through the import framework.
- **Implementation:** SOAP adapter with WSDL import; file watchers on the relay.

### Data model

Integration tables hold endpoints, credentials, mappings and message logs. Secrets are write-only (envelope-encrypted with the tenant key); payload logs are redacted at write time. Every connection, subscription and endpoint names a principal whose grants bound what it can read or write.

| Table | Key fields | States (category) | Prefix | Relationships | Access scoping |
|---|---|---|---|---|---|
| `api_client` | name, owner_id, kind (confidential/public/first_party), grant_types, redirect_uris, scopes, principal_id, certified_at | registered (new) → active → suspended (waiting) → retired (closed) | APP | principal, grants | owner + integration admins; owner certifies (ACC-080) |
| `api_token` (= `sm_api_keys`) | user_id or principal_id, name, scopes, hash, last4, expires_at, last_used_at, ip_allowlist | active → expired (closed); revoked (canceled) | — | user or principal | own; integration admins see metadata |
| `oauth_grant` | client_id, user_id, scopes, consented_at, refresh_hash, expires_at | active → expired (closed); revoked (canceled) | — | client, user | own; admins |
| `connection` (= `sm_integrations`) | connector_key, alias, environment, workspace_id, domain_id, base_url, auth_kind, credential_id, status, health, rate_limit, owner_id | ok (active), degraded / failing (waiting), disabled (closed) | — | credential, connector | integration admins of the scope; owner |
| `credential` | kind, secret_enc, vault_ref, rotation_due_at, last_rotated_at | — | — | connection | write-only; never returned |
| `connector`, `connector_action` | key, name, version, vendor, auth_schema, source / key, input_schema, output_schema, risk, required_permission | draft (new) → published (active) → deprecated (closed) | — | connections, flows, AI tools | visible to builders; executing needs the action's permission |
| `webhook_subscription`, `webhook_delivery` | topics, table, conditions, url, secret_enc, principal_id, projection, paused / event_id, attempt, status, response_code, latency_ms, next_retry_at | delivery: pending (new) → delivered (closed); failed (waiting); dead (canceled) | — | outbox events | owner + integration admins; payload projected under the principal |
| `inbound_endpoint` | token_hash, kind, mapping, target, hmac_config, idempotency_window, principal_id | active, disabled (closed) | — | flows, tables | integration admins |
| `integration_event` (= `sm_integration_events`) | connection_id, direction, correlation_id, payload_redacted, status, error, latency_ms, at | — | — | connection, record | integration admins; readers of the record see a summary |
| `dead_letter` | source, payload_ref, error, retries | open (new) → replayed (closed); discarded (canceled) | DLQ | `integration_event` | integration admins |
| `field_mapping` | owner (connection or connector), local_table, local_field, remote_field, value_map, direction, owner_side, version | draft (new) → active | — | connection | integration admins |
| `external_ref` | local_table, local_id, connection_id, remote_system, remote_id, remote_number, last_synced_at, sync_state | in_sync (active), pending / error (waiting), unlinked (closed) | — | records | follows the local record's keys |
| `federation_partner` | company_id, connection_id, mapping_set, sla_pause_rules, agreement_doc_id, principal_id | draft (new) → active → suspended (waiting) → ended (closed) | FED | company, connection, document | supplier and integration admins |
| `master_data_source` | object_table, field, authoritative_system, conflict_policy | — | — | connection | data stewards |
| `relay_agent`, `relay_job` | name, host, version, cluster, capabilities, ip_ranges, cert_fingerprint, last_heartbeat / agent_or_cluster, action, payload, lease_until, result | agent: online (active), offline (waiting), retired (closed); job: queued (new) → leased (active) → done (closed); failed, canceled (canceled) | RLY | connections, jobs | integration admins; jobs carry the run's principal |
| `mailbox` | address, protocol, server_settings, credential_id, workspace_id, default_table, allow_list, deny_list, status | active, paused / failing (waiting) | — | workspace, `email_message` | workspace admins |
| `sms_gateway`, `sms_message` | provider, sender_line, credential_id, templates, cost_per_segment / gateway_id, to, body_hash, segments, status, provider_msg_id, cost | message: queued (new) → sent (active) → delivered (closed); failed (canceled) | — | `notification_log` | admins; content follows the source record |
| `messenger_channel`, `messenger_identity` | platform, credential_id, webhook, chat_bindings, features / user_id, platform, external_user_id, verified_at, consent | identity: pending (new) → verified (active); revoked (canceled) | — | users, channels | identity: own; channels: admins |
| `call_log` | direction, caller, callee, user_id, record ref, started_at, duration, recording_ref, transcript_ref | — | — | record | record keys; recordings in the personal field class |
| `calendar_link` | owner (user or group), provider, direction, external_calendar_id, last_sync, feed_token_hash | active, error (waiting) | — | user, group | own; admins |
| `mcp_server_config` | exposed_tools, read_only, allowed_clients, ai_channel_policy_ref | — | — | tools | AI and integration admins |
| `mcp_client_server` | url, auth, allowed_tools, risk_policy, approved_by | proposed (new) → approved (active); blocked (canceled) | — | agents | AI admins |
| `ai_connection` (= `sm_ai_connections`), `ai_hold` | provider_kind, base_url, credential_id, models (capability matrix), region, residency, price / connection_id, model, reason, until | active, held (waiting), disabled (closed) | — | `ai_policy`, `ai_run` | AI admins; keys never returned |
| `knowledge_source` | connector, scope, acl_capture_mode, freshness_window, last_full_sync, delta_cursor, status | syncing (active), stale (waiting), failed / disabled (closed) | — | `ai_chunk` | knowledge and AI admins; content keys mapped from source ACLs |
| `data_lookup` | connection_id, query, cache_ttl, mapping | — | — | fields | config admins |
| `export_stream` | target, tables, principal_id, schedule_or_cdc, cursor | active, paused / failing (waiting) | — | principal | integration admins |
| `migration_project` | source_tool, mapping_templates, phase, stats, cutover_at | planning (new) → trial (active) → delta (active) → cutover (waiting) → completed (closed); canceled | MIG | `import_run` | migration lead + admins |
| `extension`, `extension_install` | key, version, publisher, permissions_requested, placements / extension_id, scope, approved_by, state | enabled (active), disabled (waiting), removed (closed) | — | extension principal | tenant admins |

### KPIs

| KPI | Formula | Source |
|---|---|---|
| Integration error rate | failed messages ÷ messages, per connection | ITIL 4 (integration KPIs) |
| Mean sync latency | mean of (partner acknowledgement time − local change time) | ITIL 4 |
| E-bonded records in sync | federated records whose state and owned fields match the partner at check time ÷ federated records | ITIL 4, SIAM BoK |
| Manual hand-offs replaced | hand-offs executed by integrations ÷ all hand-offs between tools or providers | ITIL 4 |
| Supplier interface onboarding time | go-live date − kick-off date, per new interface | ITIL 4 |
| API availability | non-5xx responses ÷ requests; uptime minutes ÷ minutes | ITIL 4 |
| API latency and throttling | p95 latency per route; throttled requests (429) ÷ requests | our design |
| Webhook first-attempt success | deliveries succeeding on the first attempt ÷ deliveries; dead-letter size and age of the oldest item | our design |
| Credential hygiene | credentials rotated within policy ÷ credentials; connections still on basic auth (target 0) | ServiceNow (Machine Identity Console) |
| Relay availability | minutes online ÷ minutes in period, per agent and cluster; lease timeouts per day | ServiceNow (MID Server health) |
| Directory sync freshness | now − last successful delta sync; errors per run | our design |
| Messenger reach | active users with a verified messenger identity ÷ active users; approvals decided in a messenger ÷ approvals | our design |
| SMS delivery | delivered ÷ sent; cost per delivered notification | our design |
| MCP tool reliability and denials | successful tool calls ÷ calls; denied calls ÷ calls (a rise is a security signal) | access research |
| Knowledge-connector freshness | p95 of (source change → index update); permission syncs that exceeded the freshness window | JSM (freshness window), Moveworks |
| Migration reconciliation | migrated records whose counts and checksums match the source ÷ source records | our design |

### Beyond the market

- **Iranian messengers as first-class channels.** Bale, Eitaa, Soroush Plus, Rubika and Telegram carry intake, notifications, approvals and agent replies; no leading ITSM supports them.
- **Iranian SMS gateways done properly.** Persian segmentation and cost, OTP sign-in and reply-to-approve.
- **The desktop app doubles as the on-premises relay.** Small sites reach their AD, servers and internal APIs without installing a separate server.
- **Local enterprise systems.** Office-automation letters (Didgah, Chargoon) and Iranian ERPs linked to requests, changes and assets.
- **Self-hosted defaults where foreign SaaS is restricted.** n8n, Skyroom and BigBlueButton, Neshan maps, RustDesk, Nextcloud and local LLMs are supported out of the box.
- **A Persian, permission-safe MCP server.** External assistants work with the ITSM through per-user revocable tokens, Persian tool descriptions and the AI-channel policy.
- **Migration kits for the incumbents of the Iranian market.** OTRS/Znuny and GLPI with full history.
- **Telephony that speaks Persian.** Asterisk/Issabel CTI with Persian speech-to-text summaries on the ticket.

## Module: access — کنترل دسترسی، هویت و ساختار سازمانی

The backbone is the access research's final recommendation. A read is allowed when the subject is in the tenant (and, in MSP mode, the record's domain is visible), every applicable **restriction** is cleared (security level, restricted group, secure workspace, classification, external fence, legal hold for destructive actions), and at least one **grant** (resource × action × scope × condition) matches through the record's **access keys**. Field classes then mask columns. One policy is compiled into three forms — a SQL predicate, access keys on records (also used for search, vectors and offline sync buckets) and an in-memory evaluator — and every surface (UI, API, search, reports, exports, notifications, webhooks, sync, AI) goes through it.

### Features

#### ACC-001 Principal model · مدل اصل‌های امنیتی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM, HaloITSM, Atlassian Rovo, NIST RBAC
- **Description:** Every actor is an explicit principal: internal user, external user (customer, partner or vendor contact), integration, AI agent or anonymous visitor. Each has kind, persona, status (active, suspended, deactivated), authentication policy, maximum offline period, external ID and provisioning source, plus an `authz_epoch` bumped on any change to its memberships, roles, delegations, elevations, clearances or org anchors. No shared or implicit system identity does user-visible work; automations and AI agents act as named principals.
- **Implementation:** `principal` + `user` (merging `sm_users` and `sm_org_members` per tenant); epoch bumped by triggers; system context only through the audited `asSystem(reason)` (ACC-051).

#### ACC-002 Person profiles and directory exposure · نمایهٔ افراد و محدودیت دیدن فهرست افراد
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, JSM, iTop
- **Description:** Profiles hold company, org unit, location, cost center, manager, title, phones, VIP flag, language, time zone, skills and photo; requester↔agent conversion, merge and deactivation. Directory exposure is limited by persona: requesters see only the name and work e-mail of people in their own company or involved in their records, external users see only the contacts on their own records, and admin accounts can be hidden from non-admins.
- **Implementation:** directory search uses a dedicated `directory` read grant with field classes (phones are personal); every people picker applies it.

#### ACC-003 Internal/external identity fence · مرز کاربران داخلی و بیرونی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, JSM
- **Description:** Every user is internal or external; roles are marked internal-only or external-allowed, and internal-only roles can never be assigned to external users. External users reach only tables and fields flagged external-visible and only through requester-side scopes; every grant on an internal resource implicitly requires the internal flag.
- **Implementation:** restriction `external_fence` (ACC-028) compiled to `r.external_visible` for external subjects; validation on role assignment.

#### ACC-004 Anonymous principal · کاربر ناشناس
- **Tier:** P1 · **AI:** no · **Sources:** JSM, GLPI, Ivanti
- **Description:** Optional anonymous access per portal: only public KB articles and public catalog items, rate-limited and CAPTCHA-protected; anonymous submissions create an unverified external contact and never expose records.
- **Implementation:** `anonymous` principal with grants on public content only; audiences with a public mode.

#### ACC-005 Companies and account hierarchy · شرکت‌ها و سلسله‌مراتب حساب‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, JSM, HaloITSM
- **Description:** Companies of kind internal, customer, vendor, partner or manufacturer with a parent hierarchy (holding → subsidiaries, customer account → child accounts); people, groups, locations and records anchor to a company; company and company-subtree scopes give customer admins and holding managers the right reach.
- **Implementation:** `company` tree in the closure table; keys `c:` and `ct:` (ACC-017).

#### ACC-006 Org unit tree · درخت واحدهای سازمانی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, Freshservice, GLPI, iTop, Dataverse, Ivanti, ITIL 4
- **Description:** A tree of org units (division, deputy, directorate, department, team, section — «معاونت»، «اداره کل»، «اداره»، «واحد») under each internal company, with head, cost center, code and active flag; drag-to-move with cycle checks; moving a unit re-keys the affected records and bumps the affected users' epochs; unit and unit-subtree scopes, unit-head approvals and reporting by unit.
- **Implementation:** `org_unit` with `tree_closure`; re-key in the same transaction for small subtrees and by job for large ones (ACC-053); unit kind labels editable.

#### ACC-007 Location tree · درخت مکان‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, BMC Helix, ManageEngine SDP, TOPdesk
- **Description:** Region → country → province → city → site → building → floor → room with address, time zone, coordinates and primary contact; sites can carry their own configuration (hours, holidays, SLAs, groups) as ManageEngine sites do; location-subtree scopes («تکنسین‌های سایت تبریز»).
- **Implementation:** `location` tree in the closure table; `lt:` keys; configuration resolved per site through ACC-058.

#### ACC-008 Cost-center tree · درخت مراکز هزینه
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, ITIL 4
- **Description:** Hierarchical cost centers with owners, used for finance-owner scopes (financial fields and aggregates of the subtree), approval routing and chargeback.
- **Implementation:** `cost_center` tree; `cct:` keys.

#### ACC-009 Manager chain and reportees · زنجیرهٔ مدیران و زیردستان
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice, Dataverse, Salesforce
- **Description:** Each person's manager forms a chain; line managers read and create requests for their reportees down to a configurable depth (default 2) and approve for them, while HR, security and restricted records of reportees stay hidden.
- **Implementation:** `mgr:` keys for each manager of the requester up to depth N, snapshotted at creation; re-anchor job after reorganisations.

#### ACC-010 Groups with types and hierarchy · گروه‌ها با نوع و سلسله‌مراتب
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, Freshservice, JSM, GLPI
- **Description:** Groups with one or more types (assignment, approval, CAB, on-call, requester, security, distribution), parent group, manager, e-mail, skills, workspace and domain; leads of a parent group can see child groups' work (group-subtree scope); pickers filter by type; users may only join groups in domains they can see.
- **Implementation:** `group` with `parent_id` in the closure table; `g:` and `gt:` keys.

#### ACC-011 Group membership kinds with validity and provenance · عضویت گروه با نوع، اعتبار زمانی و منشأ
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, access research
- **Description:** Members act according to their roles; observers read the group's records but cannot change them; leaders manage membership of non-restricted groups and approve changes to restricted ones. Memberships have validity dates and a source (manual, SCIM/IdP group, HR rule, delegation, migration) with granted-by and reason, so removing a source removes exactly what it granted.
- **Implementation:** `group_member(kind, valid_from, valid_to, source, granted_by, reason)`; epoch bump on every change.

#### ACC-012 Requester groups and dynamic membership · گروه‌های درخواست‌کننده و عضویت پویا
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice, ServiceNow, GLPI
- **Description:** Groups whose membership is computed from rules over person attributes (unit subtree, location, title, employment type, VIP) or IdP groups and recomputed when profiles change; used for catalog and KB audiences, notifications and approvals.
- **Implementation:** rule conditions stored on the group; membership rows with `source = rule` maintained by jobs.

#### ACC-013 Resource pools (RBS) · مخزن‌های منابع
- **Tier:** P2 · **AI:** no · **Sources:** Primavera P6, Clarity PPM
- **Description:** A resource-breakdown tree separate from the org tree for workforce planning and scheduling (skill pools, contractor pools): planners see and schedule only the resources in their pool subtree, independent of record visibility.
- **Implementation:** `resource_pool` tree; role assignments with context `resource_pool`.

#### ACC-014 Workspaces (ESM partitions) · فضاهای کاری (میزهای خدمت)
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, JSM, ManageEngine SDP, Xurrent
- **Description:** Records belong to a workspace (IT, HR, facilities…); agents see records of the workspaces they belong to, directly or through groups, unless a role grants all workspaces; admin roles are tenant-wide or workspace-wide; published catalog items and articles can be visible outside the workspace through audiences; secure workspaces add a restriction (ACC-030).
- **Implementation:** `workspace`, `workspace_member`; workspace term in the predicate; assignment context `workspace`.

#### ACC-015 Roles with containment and attributes · نقش‌ها با شمول و ویژگی‌ها
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, BMC Helix, Freshservice, GLPI, iTop, NIST RBAC
- **Description:** Roles are versioned permission sets (grants and field grants) that can contain other roles (a cycle-checked DAG), with attributes: elevated (only through just-in-time elevation), assignable-by role, licence type, internal-only or external-allowed, delegable by domain admins, system (shipped and resettable) or custom. Built-in roles can be copied and narrowed, compared with their default and reset.
- **Implementation:** `role`, `role_contains`; transitive closure computed in the subject context; any change bumps `policy_version`.

#### ACC-016 Grants: resource × action × scope × condition · مجوز: منبع × عمل × دامنه × شرط
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, ManageEngine SDP, JSM, ServiceNow, Dataverse, GLPI
- **Description:** Each grant names a resource (table or area), an action — read, create, update, assign, `transition:<state>`, comment_public, comment_internal, delete, link, approve, export, report_on, report_aggregate, bulk_update, share, reveal_field, merge, reopen, edit_due_date, delete_others_notes — a scope from the closed ladder and an optional condition. All grants of a subject are OR-ed (the most permissive wins). The permission-matrix editor shows areas × actions with scope drop-downs, every row labelled as a grant.
- **Implementation:** `grant(role_id, resource, action, scope, condition, field_set_id)`; compiled to keys and predicates (ACC-052).

#### ACC-017 Closed scope ladder and access keys · نردبان بستهٔ دامنه‌ها و کلیدهای دسترسی
- **Tier:** P0 · **AI:** no · **Sources:** Dataverse, Freshservice, ManageEngine SDP, GLPI, BMC Helix, Clarity PPM
- **Description:** Scopes: none, own (requester, requested-for, opened-by), assigned, participant, group, group subtree, unit, unit subtree, reportees, location subtree, company, company subtree, service subtree, cost-center subtree, project, workspace, domain subtree, all. Each maps to a typed key (`req:`, `asg:`, `par:`, `g:`, `gt:`, `o:`, `ot:`, `mgr:`, `lt:`, `c:`, `ct:`, `st:`, `cct:`, `pj:`, `ws:`, `dt:`, `t:`), so a subtree grant needs one subject key whatever the subtree size; grants narrower than their assignment context compile to registered conjunction keys such as `asg:u&ct:ACME`.
- **Implementation:** one key-derivation function shared by the database trigger and the app (ACC-053); a handful of conjunction patterns per tenant; at most 1,000 keys per subject, broader keys plus conditions above that.

#### ACC-018 Role assignment in context with recursion and provenance · انتساب نقش در زمینه با فراگیری و منشأ
- **Tier:** P0 · **AI:** no · **Sources:** GLPI, iTop, Clarity PPM, Primavera P6
- **Description:** A role is granted to a user or group in a context — tenant, domain, company, org unit, location, group, workspace, service, cost center, project or resource pool — with a recursive flag (node only, or node and descendants), validity dates, source, granted-by, reason and last-used time. "Change manager for the EMEA subtree" therefore needs no cloned role: the effective scope is the grant's scope intersected with the assignment context.
- **Implementation:** `role_assignment`; the `resolveKeys` algorithm of the access research; assignments unused for 90 days are flagged for review.

#### ACC-019 Conditional (attribute-based) grants · مجوزهای شرطی مبتنی بر ویژگی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, NIST SP 800-162, NetBox, HaloITSM, Ivanti
- **Description:** Grants can carry conditions over record fields (type, category, state, classification, client), subject attributes (persona, employment type, clearance) and environment (time window, network zone, registered device, MFA age); reusable named predicates («تغییرهای عادیِ کلاس‌های پیکربندی من») keep roles readable; conditions compile into SQL and into the in-memory evaluator.
- **Implementation:** condition AST (PLT-008) with subject and environment variables; named predicates stored as `security_attribute` rows.

#### ACC-020 Lifecycle transition rights · حق گذار وضعیت
- **Tier:** P0 · **AI:** no · **Sources:** GLPI, iTop, JSM, RT
- **Description:** Who may move a record from one state to another is a grant (`transition:<to>` with optional source states and conditions), shown per role as a from × to matrix; combined with state-model guards (required fields, approvals) and enforced on every write path.
- **Implementation:** grants with action `transition:*`; checked by `records.transition`.

#### ACC-021 Persona role templates · قالب‌های نقش برای پرسوناها
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4, Freshservice, ManageEngine SDP, GLPI, iTop
- **Description:** Shipped templates with sensible scopes for every persona: anonymous, requester, line manager, unit head, approver-only, external contact, customer admin, vendor technician, L1 and L2/L3 agents, group lead, observer, problem, change, release, configuration, asset and knowledge managers, CAB member, service owner, field technician, HR agent, security analyst, finance owner, executive viewer, tenant admin, security admin, auditor, MSP provider admin, customer domain admin, integration, AI assistant, autonomous AI agent and platform support; invitations start from a persona preset.
- **Implementation:** system roles seeded per tenant and resettable; the default matrix is documented in the access spec.

#### ACC-022 Service-desk visibility presets · پیش‌تنظیم دید میز خدمت
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, Freshservice
- **Description:** A tenant-level choice between "open service desk" (agents read all non-restricted operational records) and "need-to-know" (agents read only member-group, assigned and participant records; the default in MSP mode); switching shows the who-gains/who-loses simulation first.
- **Implementation:** the preset rewrites the agent templates' read scopes; simulation from ACC-091.

#### ACC-023 ITIL role catalogue and RACI templates · کاتالوگ نقش‌های ITIL و الگوهای RACI
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4, ITIL v5, FitSM
- **Description:** A seeded catalogue of practice roles (incident manager, major-incident manager, change authority, configuration manager, service owner, practice owner and others) mapped to competency profiles, with RACI templates per practice activity that derive default grants, approvers and notifications and document who is accountable for each practice.
- **Implementation:** `practice_role` and `raci_entry` reference tables linked to roles; installed with content packs.

#### ACC-024 Granular admin roles · نقش‌های مدیریتی ریزدانه
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow, ITIL 4, Freshservice, JSM
- **Description:** Administration is split into tenant admin (configuration, no data by default), security admin (elevated), user-access admin, workspace admin and module admins (incident, change, SLA, catalog, knowledge, CMDB, workflow, notification, integration, AI, data); each grants view/edit/delete/manage per settings area at tenant or workspace scope. Admin status never passes restrictions (ACC-028) and never implies data access.
- **Implementation:** settings areas registered like resource areas; grants with action `admin:<area>`.

#### ACC-025 Configuration-object ownership and delegated building · مالکیت اشیای پیکربندی و واگذاری ساخت
- **Tier:** P1 · **AI:** no · **Sources:** HaloITSM, ServiceNow, JSM
- **Description:** Individual configuration objects (a catalog, a template set, a flow, a dashboard) have owners and editors, so departmental admins maintain their own items; security-relevant configuration (roles, grants, restrictions, scripts, integrations) needs separate rights even inside a delegated area.
- **Implementation:** `owner_id` and `editors` on configuration tables plus `configure:<object>` grants; security tables excluded from delegation.

#### ACC-026 Licence types and limited roles · انواع مجوز و نقش‌های محدود
- **Tier:** P1 · **AI:** no · **Sources:** JSM, Freshservice, ServiceNow
- **Description:** Roles declare the licence they consume. Unlicensed limited roles cover common needs: approver-only (decides from portal, e-mail or messenger), stakeholder (reads incident updates), collaborator (internal notes and attachments on records shared with them, no public replies, cannot be assignee); occasional agents consume day passes.
- **Implementation:** `role.licence`; seat accounting in ADM-026.

#### ACC-027 Persona and context switcher · جابه‌جایی نقش و زمینهٔ کاری
- **Tier:** P1 · **AI:** no · **Sources:** Ivanti, GLPI, ServiceNow
- **Description:** People who are both requesters and agents switch between the portal (requester view) and the workspace (agent view); MSP staff choose an active domain or "all visible domains"; the active persona and domain appear in the header and drive AI context pinning.
- **Implementation:** session `active_persona` and `active_domain`; predicates stay the union of grants while UI and AI scope narrow.

#### ACC-028 Restriction layer (deny-unless) · لایهٔ محدودیت‌ها (منع مگر با صلاحیت)
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (Deny-Unless ACLs), Salesforce restriction rules, JSM security levels, Freshservice restricted groups, NIST SP 800-162
- **Description:** Restrictions are AND-ed with grants and outrank admin status: a record matching a restriction's `applies` predicate is readable only by subjects holding the matching clearance. Kinds: security level, restricted group, secure workspace, classification, external fence, legal hold (blocks delete, purge and anonymisation) and read-only overlay; the admin UI labels every rule "grant" or "restriction", and tenant admins pass a restriction only with an explicit clearance.
- **Implementation:** `restriction(kind, resources[], applies AST, active)`, `clearance(principal_id, restriction_id, level_id, valid_to, source, granted_by)`; compiled as AND terms (ACC-052).

#### ACC-029 Security levels and clearances · سطوح امنیتی و صلاحیت دسترسی
- **Tier:** P0 · **AI:** no · **Sources:** JSM (work-item security schemes), ServiceNow, ISO/IEC 27001 A.8.3
- **Description:** Ranked security schemes per resource; a record carries at most one level, set by hand, by request type, by rule or on an AI suggestion, and is visible only to principals cleared for it through a role, group, user or dynamic principal (reporter, assignee, participants) when the scheme allows. Setting a level is its own action (`set_security_level`).
- **Implementation:** `security_scheme`, `security_level(scheme_id, name, rank)`; record column `security_level_id`; sync buckets `sl:<level>|<key>` (ACC-056).

#### ACC-030 Secure workspaces · فضاهای کاری امن
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice (restricted workspaces), ServiceNow HRSD, ISO/IEC 27001 A.8.3, EU Whistleblowing Directive
- **Description:** HR, legal, security office («حراست»), employee-relations and whistleblowing workspaces admit only explicit members: tenant admins, platform support and auditors get no implicit access, impersonation is blocked, break-glass entry needs two-person approval, and records stay out of global search, cross-workspace reports and general assistants; the workspace's published catalog items and articles stay visible through audiences.
- **Implementation:** `workspace.secure` → restriction `secure_workspace`; buckets `ws:<id>|<key>`; optional separate data key for whistleblowing.

#### ACC-031 Restricted groups · گروه‌های محدودشده
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, access research (extended to every resource type)
- **Description:** Records assigned to a restricted group — tickets, problems, changes, tasks or cases — are visible only to its members with a group-scoped read grant, plus the requester unless `hide_from_requester` is set. Adding members, granting leadership, lifting the restriction or deleting the group needs a leader's approval (first decision wins), and members cannot be impersonated.
- **Implementation:** `group.restricted`, `group.leader_approval`; record column `restricted_group_id`; bucket `rgx:<group>`.

#### ACC-032 Data classification labels · برچسب‌های طبقه‌بندی اطلاعات
- **Tier:** P0 · **AI:** no · **Sources:** ISO/IEC 27001 A.5.12–5.13, ITIL 4 (information security), JSM (Atlassian data classification), ServiceNow
- **Description:** Every secured record and attachment carries a ranked classification (public, internal, confidential, restricted; renameable, for example to the Iranian scheme «عادی، محرمانه، خیلی محرمانه، سری»). Defaults come from table, workspace, request type or service, inbound payloads are classified on intake, readers need a classification ceiling at least as high, and the label also drives export, sharing, AI, offline and retention policies. Lowering a label is the audited `declassify` action.
- **Implementation:** column `classification` + `classification_label` table; ceiling in the subject context; ACC-100 policies keyed by label.

#### ACC-033 Participant, watcher and approver access · دسترسی مشارکت‌کنندگان، دنبال‌کنندگان و تأییدکنندگان
- **Tier:** P0 · **AI:** no · **Sources:** JSM (request participants, approvers), ServiceNow (watch list), Freshservice (CC), Request Tracker (Cc roles)
- **Description:** Watchers, CC'd people, request participants, approvers with an open approval, CAB members on an agenda and share holders get the participant key: they read public fields and comment publicly, subject to restrictions. Approver-only users keep a 30-day read-only tail after deciding.
- **Implementation:** `par:` keys derived from `watcher`, `approval` and `share` rows; an expiry job removes tails.

#### ACC-034 Customer organizations, request sharing and department visibility · سازمان‌های مشتری، اشتراک درخواست و دید واحد
- **Tier:** P0 · **AI:** no · **Sources:** JSM (customer organizations, sharing settings), Freshservice (department heads, prime users), ServiceNow CSM, ManageEngine SDP (requester view scope)
- **Description:** Requesters belong to organizations (auto-grouped by e-mail domain or IdP); each workspace or portal sets sharing to off, within the organization, or with named portal users, and requesters share a request with their organization or named people. Organization admins and «کاربران ارشد» (prime users) see all requests of their organization or department, minus restricted records.
- **Implementation:** `customer_org`, `customer_org_member`; `share(reason = org_share)`; `c:`/`ot:` keys for prime users.

#### ACC-035 Hand-off grace access · دسترسی مهلت‌دار پس از واگذاری
- **Tier:** P0 · **AI:** no · **Sources:** our design (replaces TOPdesk's implicit last-changer visibility; fixes ManageEngine's "not in your permitted scope" after reassignment)
- **Description:** On reassignment the previous assignee and group get read-only participant shares that expire (default 7 days), so they can follow up; the shares show in the record's access explanation and can be revoked.
- **Implementation:** `share(reason = handoff_grace, expires_at)` written by the assignment write path.

#### ACC-036 Record shares and broadcast shares · اشتراک‌گذاری رکورد و انتشار خلاصهٔ عمومی
- **Tier:** P1 · **AI:** no · **Sources:** Salesforce manual sharing, JSM (share request), ServiceNow, access research
- **Description:** Users with the `share` action give a named principal read, comment or edit access with reason and expiry, listed on the record and audited; collaboration invitations use shares; a broadcast share publishes a read-only major-incident summary to an audience without opening the record. Shares never cross a classification ceiling.
- **Implementation:** `share(resource, record_id, principal_id, access, reason, expires_at, created_by)`.

#### ACC-037 Write-scope (post-image) rule · قاعدهٔ ماندن در دامنهٔ نوشتن پس از تغییر
- **Tier:** P0 · **AI:** no · **Sources:** access research, iTop (silo checks on write)
- **Description:** After an update the record must still lie inside the subject's write scope, unless the action is an explicit hand-off (assign, escalate, transfer to another workspace or provider) with its own permission. This blocks moving a record into a scope one may not write.
- **Implementation:** post-image evaluation in `records.update`; hand-off actions recognised by the patch classifier.

#### ACC-038 Option rules · قواعد مقادیر مجاز
- **Tier:** P1 · **AI:** no · **Sources:** Znuny/OTRS ACL module, ServiceNow (choice-level controls), GLPI
- **Description:** Context-dependent allowed values and actions, for example only CAB members set change risk "High", HR categories only inside the HR workspace, "Resolved" only with a resolution code, the VIP flag only by desk managers. Rules match record, subject and context, add or remove possible values and can stop later rules; pick-lists are filtered in the UI and re-validated on the server.
- **Implementation:** `option_rule(resource, match AST, field, mode{possible, possible_not, possible_add}, values, priority, stop)`.

#### ACC-039 Create on behalf of others · ثبت از طرف دیگران
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4 (request on behalf), Freshservice (requests for others), ServiceNow, JSM (raise on behalf of customer)
- **Description:** `create_on_behalf` is a grant with its own scope: line managers for reportees, assistants for their executive, agents for any internal user or for customers of their accounts. The record stores opened-by and requested-for separately, and the requested-for person gets the requester view and notifications.
- **Implementation:** grant action `create_on_behalf` with scope; key derivation adds `req:` for both people.

#### ACC-040 Audiences (user criteria) · مخاطبان (معیارهای کاربر)
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow user criteria and HR criteria, Freshservice requester groups, JSM request-type restrictions, Confluence space permissions
- **Description:** Reusable audiences (users, groups, roles, companies, units ± subtree, locations ± subtree, requester groups, conditions; match all or any) are bound to knowledge bases, articles, catalog items, request types, announcements, portal widgets and AI knowledge sources as can/cannot read, contribute or request. Deny wins and article bindings only narrow their base; audiences are checked when listing and again at submission through every channel, and a channel that cannot identify the user gets only public items. A diagnostics view explains each decision.
- **Implementation:** `audience`, `audience_binding`; compiled to predicates and cached per subject epoch.

#### ACC-041 Separation of duties · تفکیک وظایف
- **Tier:** P0 · **AI:** no · **Sources:** ISO/IEC 27001 A.5.3, COBIT DSS06.03, ITIL 4 (change authority), SOX, access research
- **Description:** Dynamic rules on records (requester ≠ approver, implementer ≠ approver, author ≠ production-deployment approver, purchaser ≠ receiver, disposal approver ≠ executor, optional KB author ≠ publisher) and static role conflicts (security admin ⊥ auditor, tenant admin ⊥ auditor, access requester ⊥ access approver). Each rule blocks, warns with justification or requires a second approver. A conflicted sole approver escalates up the authority matrix; conflicts are checked on assignment, approval and access review and reported to auditors.
- **Implementation:** `sod_rule(kind, left, right, mode)`, `sod_violation`; checked in the write path and the approval engine (PLT-051).

#### ACC-042 Approval authority matrix · ماتریس اختیارات تأیید
- **Tier:** P1 · **AI:** no · **Sources:** COBIT DSS06.03, ITIL 4 (change authority), ERP delegation-of-authority practice, access research
- **Description:** A versioned matrix of who may approve what by record type, category, risk, amount (Rials with currency), cost center, unit and service, with levels (unit head → deputy «معاون» → CEO), thresholds and fallbacks. Approval rules point to the matrix instead of naming people, and absent or conflicted approvers escalate to the next level.
- **Implementation:** `authority_matrix`, `authority_level`; resolver used by the approval engine; changes go through ACC-091.

#### ACC-043 Read-only and API-only account modes · حالت‌های حساب فقط‌خواندنی و فقط‌API
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow (read-only role, web-service-access-only and internal integration users), JSM (service accounts)
- **Description:** A read-only overlay makes a principal read-only everywhere whatever its roles (auditors, investigations, staff under notice); API-only accounts cannot open the UI and UI-only accounts cannot use API tokens; locked and suspended states block every sign-in while keeping history and attribution.
- **Implementation:** restriction kind `read_only_overlay`; `user.login_modes{ui, api}`.

#### ACC-044 Field classes and masking · کلاس‌بندی فیلدها و پوشاندن مقدار
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow field ACLs, BMC AR field permissions, Ivanti field rights, JSM comment visibility, ISO/IEC 27001 A.8.11
- **Description:** Every field has a class — public, internal, personal, sensitive, secret, financial, hr, security — with default read and write audiences, a mask (none, partial, full, hash-match), allowed query operators and AI, offline, search and export flags. One compiled mask governs projection (masked columns return null plus mask metadata), history ("field changed" without values), notifications, exports, API, webhooks, indexes, the offline replica and AI prompts. Internal fields and work notes never reach requesters or external users, and exporting sensitive classes needs step-up and is logged.
- **Implementation:** `field_policy(resource, field, class, mask, query_ops, ai, offline, search, export)`.

#### ACC-045 Inference control on filters, sorts and aggregates · کنترل استنتاج در فیلتر، مرتب‌سازی و تجمیع
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow query ACLs (query_match, query_range), access research
- **Description:** Filters, sorts, group-bys and aggregates are accepted only on fields whose class and the subject's field grants allow the operator: match operators (=, IN, empty) versus range operators (contains, starts with, comparisons, between, sorting). Hash-match fields allow "find by national ID" without revealing values. Refused operators return "not filterable" instead of silently dropping rows, and unreadable IDs return 404, never 403.
- **Implementation:** operator check in the list and aggregate pipeline; `field_policy.query_ops`, `field_grant.query_range`.

#### ACC-046 Field grants, reveal with reason and state locks · مجوز فیلد، نمایش با ذکر دلیل و قفل وابسته به وضعیت
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (field ACLs, read-only option levels, HR field security), Freshservice, GLPI 11 (form access controls), Ivanti
- **Description:** Roles carry field grants per field or class (read, write, unmask, range query). Revealing a masked value asks for a reason (plus step-up for sensitive classes) and is read-audited. The server locks fields by state (resolution after closure, amounts after approval); client-side form rules are only UX.
- **Implementation:** `field_grant(role_id, resource, field_or_class, read, write, unmask, query_range)`; state locks as conditions on `field_policy`.

#### ACC-047 Field encryption and keyed lookup · رمزنگاری فیلد و جست‌وجوی بدون افشا
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow Column Level Encryption Enterprise and Key Management Framework, Salesforce Shield, ISO/IEC 27001 A.8.24
- **Description:** Sensitive and secret columns use envelope encryption with a per-tenant data key, optionally wrapped by a customer-managed key in the customer's HSM or KMS. A per-tenant HMAC column serves exact lookups (national ID, passport, card number) without decryption. Secret fields (passwords in masked variables, recovery codes) are write-only and purged after fulfilment, and key rotation re-wraps data keys online.
- **Implementation:** `tenant.kms_key_ref`; crypto helper shared with the credential store (INT-007); HMAC key per tenant.

#### ACC-048 Child-record and attachment inheritance · ارث‌بری دسترسی رکوردهای فرزند و پیوست‌ها
- **Tier:** P0 · **AI:** no · **Sources:** BMC Helix (task group added to the parent's access field), ServiceNow (parent-table ACLs), access research
- **Description:** Child records inherit the parent's keys with adjustments: internal notes drop requester and external participant keys, tasks add their own group keys, and SLA instances, approvals, attachments and RAG chunks copy the parent's keys. Attachments are served only after a server check through short-lived signed URLs. A child may be narrower than its parent but never wider unless explicitly shared.
- **Implementation:** key profile per child resource (`inherit_from`, `drop`, `add`) in `deriveKeys`; blob dedupe keeps per-parent references.

#### ACC-049 Sensitive-data detection and masking · کشف و پوشاندن خودکار دادهٔ حساس
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow Data Privacy for Now Assist, Salesforce Einstein Trust Layer, Atlassian Rovo Chat security, access research
- **Description:** Deterministic detectors (national ID, card and Sheba/IBAN numbers, mobile numbers, passwords, API keys) plus a model for HR and medical text scan descriptions, comments, e-mails and attachments on intake. Secrets are masked at once, and the system proposes a classification, restriction or field class. The same detectors feed the anonymiser of clones and exports and the reversible placeholders of AI prompts.
- **Implementation:** intake-pipeline step with detectors and an AI skill; `dlp_finding(record, field, kind, action, decided_by)`.

#### ACC-050 Aggregate-only access and small-cell suppression · دسترسی فقط تجمیعی و حذف خانه‌های کم‌شمار
- **Tier:** P1 · **AI:** no · **Sources:** access research, Dataverse and Salesforce reporting patterns, statistical disclosure control
- **Description:** The `report_aggregate` action lets executives, finance owners and admins see counts, averages and trends over records they cannot read row by row. Cells under k records (default 5) are suppressed for classes with small-cell protection, drill-down opens only records the viewer could read anyway, and AI statistical answers use the same aggregates.
- **Implementation:** aggregate queries compiled under `report_aggregate` grants; suppression in the report engine.

#### ACC-051 Audited system context · زمینهٔ سیستمی ممیزی‌شده
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (GlideRecord vs GlideRecordSecure lesson), Freshservice (workflows running with system privileges), access research
- **Description:** Code that must bypass user permissions (retention, re-keying, integrity checks, timers) runs only inside `asSystem(reason)`, which logs reason and counts and is flagged in code review. Flows, rules, integrations and AI agents never use it; they run as named principals (the triggering user, a run-as principal or the agent identity).
- **Implementation:** lint rule and runtime guard; one `privileged_action_log` row per invocation.

#### ACC-052 Policy compiler: one policy, three forms · کامپایلر سیاست: یک سیاست، سه شکل اجرا
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (security data filters, before-query rules), BMC Helix (row-level security), NetBox (constraints as filters), iTop (silos), OPA/Cedar partial evaluation, access research
- **Description:** Default deny. Grants and restrictions compile into (a) a SQL predicate applied before the query, so counts, paging, sorting and aggregates are exact, (b) access keys on records for indexes, search, vectors and sync buckets, and (c) an in-memory evaluator for single-record checks, UI affordances and offline UX. Every surface — UI, API, search, reports, dashboards, exports, notifications, webhooks, sync, MCP and AI — goes through it, and property-based tests prove the three forms agree.
- **Implementation:** `compileRead`, `evaluate`, `deriveKeys` in the access provider; parity suite in CI (ACC-101).

#### ACC-053 Access-key derivation, re-keying and reconciliation · تولید کلید دسترسی، کلیدگذاری مجدد و تطبیق
- **Tier:** P0 · **AI:** no · **Sources:** access research, BMC Helix (access field written at submit), PowerSync (parameterised buckets)
- **Description:** A database trigger and the same application function derive each record's keys from its anchors and their ancestors. Requester anchors are snapshotted at creation, while assignment and service anchors stay live. Moving a unit, group, location, company, service or domain re-keys small subtrees in the same transaction and large ones through an idempotent job; restriction changes are synchronous. A nightly reconciliation recomputes keys and alerts on drift, and index entries pending re-key stay hidden (fail closed).
- **Implementation:** `acl_keys text[]` with GIN, `acl_version`; outbox re-key events to search, vectors and sync.

#### ACC-054 Tenant isolation with row-level security · جداسازی سازمان‌ها با امنیت سطری پایگاه‌داده
- **Tier:** P0 · **AI:** no · **Sources:** PostgreSQL RLS, BMC Helix, ISO/IEC 27017, access research
- **Description:** Every table runs under forced restrictive RLS policies keyed on a transaction-local tenant setting (and, in MSP mode, visible domains), so a forgotten predicate cannot cross tenants. Encryption keys, vector partitions and storage prefixes are per tenant. Tenants that need full isolation, their own keys or their own residency get a dedicated deployment (ADM-024).
- **Implementation:** `FORCE ROW LEVEL SECURITY`, `SET LOCAL app.tenant_id`; a SECURITY DEFINER key function if a client ever queries the database with user tokens.

#### ACC-055 Subject context, authorization epochs and instant revocation · زمینهٔ مجوز کاربر، شمارندهٔ تغییر و لغو فوری
- **Tier:** P0 · **AI:** no · **Sources:** access research, ServiceNow (role closure at login), JSM (permission caching with invalidation)
- **Description:** Each request builds the subject context once (visible domains, groups with membership kind, anchors, role closure, grants, clearances, field masks, keys) and caches it under (user, `authz_epoch`, `policy_version`). Triggers bump the epoch on any change to memberships, roles, delegations, elevations, clearances or anchors, so revocation is immediate on the server. Sessions and tokens of deactivated users die at once, and sync and AI caches follow the epoch.
- **Implementation:** `user.authz_epoch`, `tenant.policy_version`; per-worker LRU cache.

#### ACC-056 Offline replica security · امنیت نسخهٔ آفلاین
- **Tier:** P0 · **AI:** no · **Sources:** access research, PowerSync and ElectricSQL patterns, NIST SP 800-63B-4, Microsoft Intune (selective wipe)
- **Description:** Devices sync only what the user may read: buckets equal access keys, restrictions are folded into prefixed keys, and classified fields travel in side tables only to subjects with the field grant (secret, sensitive, HR and security never by default). Broad-scope users sync a working set. The local database is encrypted with a key wrapped by DPAPI and unlocked by Windows Hello or PIN, and a per-persona maximum offline period locks the replica. Devices are registered, revocable and remotely wiped; offline writes are proposals re-checked on upload, and local checks are UX only.
- **Implementation:** `device(user_id, platform, registered_at, last_sync_at, wipe_requested_at, key_ref)`; authoritative bucket list sent at every connection.

#### ACC-057 MSP domain separation · جداسازی دامنه‌ها برای ارائه‌دهندگان خدمات مدیریت‌شده
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow domain separation, BMC Helix multi-tenancy, GLPI entities, iTop organizations, ITIL 4 (SIAM)
- **Description:** Off by default (one hidden root domain). MSP mode adds a domain tree: root → provider → customer → sub-domains for subsidiaries, plus process domains (shared configuration, no data) and data domains (shared KB, catalog or global CIs). Records inherit the domain of their company or requester unless a managed domain is set, and visible domains = own subtree ∪ explicit visibility ∪ "contains" links. External users belong to exactly one domain, users join only groups of visible domains, and a domain picker sets the active domain.
- **Implementation:** `domain(parent_id, path, kind)`, `domain_visibility`; `domain_id` on separated tables; RLS domain fence; `dt:` keys.

#### ACC-058 Process separation and configuration override chain · جداسازی فرایند و زنجیرهٔ جایگزینی پیکربندی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow (process separation), GLPI (inherit from parent entity), ManageEngine SDP (sites as configuration units), Freshservice workspaces
- **Description:** Configuration objects — SLA definitions, business hours and holidays, assignment rules, flows, approval matrices, notification templates, forms, catalog items, KB bases, branding and AI settings — can be overridden per domain, workspace, company or site. Resolution walks from the record's context up to the root and the nearest override wins; overrides are marked, diffable against the parent and resettable.
- **Implementation:** `scope_type`/`scope_id` on configuration tables; one `resolveConfig(kind, record)` helper with caching.

#### ACC-059 Bounded delegated administration · مدیریت واگذارشدهٔ محدود
- **Tier:** P1 · **AI:** no · **Sources:** iTop (allowed organizations for delegated admins), ServiceNow (domain admins), GLPI, Atlassian (user access admin), ITIL 4 (federated governance)
- **Description:** Workspace, company, site and customer-domain admins manage users, groups, catalog, notifications and branding inside their own administrable set only. They can grant only roles marked delegable, never elevated roles or clearances, and never create cross-domain visibility, which needs the tenant security admin.
- **Implementation:** `role.delegable`; `administrable_set(subject)` check on every security write.

#### ACC-060 Cross-domain provider work and shared data domains · کار بین‌دامنه‌ای ارائه‌دهنده و دامنه‌های دادهٔ مشترک
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow (MSP domains), BMC Helix (company access, unrestricted access), HaloITSM (client restrictions)
- **Description:** Provider groups live in the provider domain and see all descendant customer domains through subtree keys, while customer records assigned to them stay in the customer's domain. Provider reports group by domain and customers see only their own. Global reference data (shared KB, catalog, CI classes, global CIs) lives in data domains visible to all.
- **Implementation:** `dt:` keys for provider groups; report dimension `domain_id`; data-domain visibility links.

#### ACC-061 Work delegation · تفویض کار
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (standard and granular delegation), Freshservice (approval delegation), ITIL 4
- **Description:** A user delegates approvals, assignments and/or notifications for a period, optionally with conditions ("only standard changes", "only requests under 50 million Rials") and "exclude confidential notifications". The delegate gets no standing access, only participant shares on the records under delegated approval or assignment for that period. Decisions read "approved by X on behalf of Y"; one active delegate per kind by default; delegations are visible to the delegator and audited.
- **Implementation:** `delegation(delegator_id, delegate_id, kinds[], condition, valid_from, valid_to, exclude_confidential)`; resolved by the approval and assignment engines.

#### ACC-062 Access delegation · تفویض دسترسی
- **Tier:** P1 · **AI:** no · **Sources:** access research, ServiceNow (delegates), Salesforce sharing to assistants
- **Description:** An executive's assistant reads, and optionally creates and comments on, the executive's requests through an explicit record-access delegation. It is bounded by the delegator's own scope, excludes restricted classes and secure workspaces, is time-boxed, visible to the delegator and audited.
- **Implementation:** delegation kind `record_access` → role assignment with `source = delegation`.

#### ACC-063 Out-of-office automation · خودکارسازی غیبت و مرخصی
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice, ServiceNow, ManageEngine SDP, Exchange/Outlook out-of-office
- **Description:** Leave from the calendar or HR system, or a user's own "away" dates, creates time-boxed delegations, removes the agent from round-robin and on-call routing, flags the absence in pickers and approvals, and restores everything on return. Booking an absence for someone else needs a permission.
- **Implementation:** `absence(user_id, starts_at, ends_at, source)`; jobs create and expire delegations; routing reads availability.

#### ACC-064 Just-in-time privileged elevation · ارتقای موقت دسترسی ممتاز
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (elevated roles, security_admin), Microsoft Entra PIM, ISO/IEC 27001 A.8.2
- **Description:** Elevated roles (security admin, data export, bulk delete, freeze override, write impersonation) are never standing. Users request them with a reason and duration, optionally approved by a second person, with step-up MFA on activation. They expire automatically, a banner shows while active, and every action goes to the privileged-action log.
- **Implementation:** `elevation(user_id, role_id, context, reason, approved_by, mfa_at, starts_at, ends_at)`; active elevations join the subject context.

#### ACC-065 View-as (impersonation) with guardrails · مشاهده از نگاه کاربر دیگر با محافظ
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow impersonation (HR data blocked), Freshservice assume identity (blocked for restricted groups), access research
- **Description:** Admins and support staff view the app as another user to troubleshoot: read-only by default, with a permanent banner, no secure workspaces, restricted groups, HR or security data, and no unmasking. Write impersonation is a separate elevated permission with a reason. Both identities are stored on every action, and the impersonated user can see that it happened.
- **Implementation:** session `acting_as` + `real_user`; restrictions forced on; `privileged_action_log`.

#### ACC-066 Break-glass emergency access · دسترسی اضطراری
- **Tier:** P0 · **AI:** no · **Sources:** Microsoft Entra emergency-access guidance, ITIL 4 (temporary elevation), ISO/IEC 27001 A.8.2
- **Description:** At least two emergency accounts per tenant that do not depend on the tenant's IdP (local passkeys, sealed credentials) cover IdP outages and lock-outs. Every use alerts the security admins, sessions expire quickly, a post-use review is mandatory and drills are scheduled; entry into secure workspaces still needs two-person approval.
- **Implementation:** `principal.kind = break_glass`; alert flow; review tasks through PLT-056.

#### ACC-067 Vendor support access grants · مجوز دسترسی پشتیبانی فروشنده
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow, Atlassian (support access), access research
- **Description:** Platform or implementation-partner staff have no access by default. A tenant admin approves a time-boxed, scoped support grant (configuration only, or named records). Grants appear in the tenant audit log, exclude secure workspaces unless the security admin adds them, and can be revoked at any time.
- **Implementation:** `support_grant(tenant_id, vendor_user_id, scope, approved_by, starts_at, ends_at)`.

#### ACC-068 Degraded-mode authentication · احراز هویت در حالت اختلال
- **Tier:** P2 · **AI:** no · **Sources:** access research, Microsoft Entra (resilience defaults)
- **Description:** If the IdP fails during a major incident, existing agent sessions may be extended within a bounded, logged window, and desktop users keep working on their replica within the offline period, instead of everyone being signed out.
- **Implementation:** session-extension policy with a hard maximum; audit entries per extension.

#### ACC-069 Single sign-on (OIDC, SAML, Kerberos) · ورود یکپارچه
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow Multi-Provider SSO, Atlassian Guard, Freshservice, ManageEngine SDP, GLPI, Keycloak
- **Description:** Per-tenant OIDC (authorization code + PKCE) and SAML 2.0 with several IdPs (staff, each customer account, partners). It offers home-realm discovery by e-mail domain, single logout, encrypted assertions, JIT user creation with attribute mapping, and Windows integrated sign-in (Kerberos) for on-premises deployments. Local IdPs common in Iranian organisations (AD FS, Keycloak, FreeIPA) are supported, and enforcement is set per user cohort.
- **Implementation:** `idp_connection(protocol, metadata, domains, cohort, jit_mapping, status)`; auth service in the API.

#### ACC-070 Multi-factor authentication and passkeys · احراز هویت چندعاملی و کلید عبور
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow MFA, Atlassian Guard two-step verification, GLPI (2FA per profile and entity), NIST SP 800-63B-4
- **Description:** Passkeys/WebAuthn (Windows Hello, hardware keys), TOTP apps and recovery codes, enforced per role, persona, entity or network zone. SMS or messenger OTP is allowed only for external users, as a restricted authenticator. Smart-card or token certificates from Iran's licensed CAs serve high-assurance users. MFA reset is a verified self-service or desk flow.
- **Implementation:** `mfa_factor(user_id, kind, credential, created_at, last_used_at)`; requirements in `auth_policy`.

#### ACC-071 Session and network policies · سیاست‌های نشست و شبکه
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow adaptive authentication and IP access control, Atlassian Guard authentication policies, NIST SP 800-63B-4
- **Description:** Authentication policies per user cohort set idle and absolute timeouts (agents ≤ 24 h overall, ≤ 1 h idle), concurrent-session limits, session lists with remote sign-out, IP allowlists and network zones (office, VPN, internet) usable as grant conditions, registered-device trust and third-party login blocking. Sessions and tokens are revoked on role change or deactivation.
- **Implementation:** `auth_policy(cohort, idle, absolute, mfa, ip_ranges, zones, max_offline_hours)`; `session` table with revocation.

#### ACC-072 Local accounts, passwords and self-service recovery · حساب محلی، گذرواژه و بازیابی خودخدمت
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (password policies, password reset), Freshservice, GLPI, NIST SP 800-63B-4
- **Description:** Tenants without an IdP use local accounts with NIST-style rules: minimum length, breached-password check, no forced periodic change and no security questions. Failed attempts trigger lockout with back-off and CAPTCHA. Users verify by e-mail or SMS for self-service reset and unlock, and admins can force a reset or MFA re-enrolment.
- **Implementation:** Argon2id hashes; offline breached-password list; throttling from failed `signin_event` rows.

#### ACC-073 Step-up authentication and electronic signatures · احراز هویت تکمیلی و امضای الکترونیکی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow (e-signature on approvals), NIST SP 800-63B-4 (reauthentication), ITIL 4 (non-repudiation), FDA 21 CFR Part 11
- **Description:** Action classes such as approving a high-risk change, revealing or exporting sensitive data, publishing access policy or activating an elevation need recent authentication (configurable recency and level). Alternatively, an e-signature re-authenticates and binds signer, meaning and time to the record. Where law requires, the signature uses a digital certificate (INT-045).
- **Implementation:** `stepup_requirement(action_class, max_age, level)`; `signature(resource, record_id, signer_id, meaning, method, signed_at, hash)`.

#### ACC-074 External identities and portal access modes · هویت‌های بیرونی و حالت‌های دسترسی پرتال
- **Tier:** P0 · **AI:** no · **Sources:** JSM (customer access types, portal-only accounts, customer SSO), ServiceNow CSM, Freshservice, GLPI
- **Description:** Customers, vendor contacts and partners are a separate identity class with their own policies: customer SSO per account, magic-link or OTP sign-in (e-mail, SMS, messenger), allowed e-mail domains, self sign-up on or off per portal, invitation-only portals, re-verification and expiry tied to contracts. They never hold internal roles.
- **Implementation:** `user.kind = external`; `portal_access_policy(portal, mode{open, domains, invite}, signup, verification)`.

#### ACC-075 SCIM 2.0 provisioning endpoint · نقطهٔ تأمین خودکار کاربران SCIM
- **Tier:** P0 · **AI:** no · **Sources:** SCIM 2.0 (RFC 7643/7644), Atlassian Guard, Freshservice (Okta, Entra ID), ServiceNow
- **Description:** A tenant SCIM endpoint (Users, Groups, enterprise extension: employeeNumber, costCenter, organization, division, department, manager) lets Entra ID, Okta, Keycloak and other IdPs create, update and deactivate users and push groups. IdP groups map to our groups and roles with provenance. It complements pull-based directory connectors (INT-013).
- **Implementation:** SCIM routes in the API; bearer token per IdP integration principal; `scim_mapping`.

#### ACC-076 Sign-in risk detection · تشخیص ریسک ورود
- **Tier:** P1 · **AI:** yes · **Sources:** Atlassian Guard detections, Microsoft Entra ID Protection, ServiceNow adaptive authentication
- **Description:** Sign-in signals (new device, unusual country or network, impossible travel, password spraying, token reuse) feed a risk score that requires step-up, blocks, or notifies the user and security admins. A model learns normal sign-in patterns per user and integration, and detections can open security incidents.
- **Implementation:** `signin_event` stream; rules plus an anomaly-scoring AI skill; actions through flows.

#### ACC-077 Joiner–mover–leaver automation · خودکارسازی ورود، جابه‌جایی و خروج افراد
- **Tier:** P0 · **AI:** no · **Sources:** ITIL 4, ISO/IEC 27001 A.5.16, A.5.18, A.6.5, COBIT DSS05.04, NIST CSF PR.AA, Freshservice (onboarding/offboarding)
- **Description:** Joiners from SCIM, directory or HR get a user with anchors, persona and rule-based roles. For movers, contexts are recomputed: old access is revoked as new access is granted, the epoch is bumped and live anchors are re-keyed. Leavers are deactivated with same-day revocation of sessions, tokens and devices. Their open work is reassigned, owned reports, dashboards, flows and integrations are transferred, assets are recovered and orphan accounts are detected.
- **Implementation:** lifecycle events → flows; `jml_event` log; orphan-account detection job.

#### ACC-078 Attribute-based provisioning rules · قواعد تخصیص خودکار نقش بر پایهٔ ویژگی
- **Tier:** P0 · **AI:** no · **Sources:** GLPI (authorization rules), ServiceNow (roles from IdP groups), Atlassian (group sync), access research
- **Description:** Rules map IdP or HR attributes and groups to role assignments in context, group memberships and audiences. For example, `department = Finance` → requester role + finance audience; IdP group `IT-EMEA-L2` → agent role in group context EMEA-L2. Each assignment records `source = hr_rule` and is removed when the rule stops matching. A preview lists affected users before activation.
- **Implementation:** `provisioning_rule(match AST, actions[], active)`; recompute job on profile changes.

#### ACC-079 Agent lifecycle and licence controls · چرخهٔ عمر کارشناس و کنترل مجوز
- **Tier:** P1 · **AI:** no · **Sources:** Freshservice (agent deactivation, occasional agents), JSM, ServiceNow
- **Description:** Requesters convert to agents and back. Agents are full-time or occasional (day pass). Deactivation blocks login, returns open items to the group queue, removes the agent from on-call and round-robin, and lists flows, rules and reports that still name the person. Reactivation restores roles from provenance.
- **Implementation:** `user.licence_state`; deactivation flow; reference scanner over configuration tables.

#### ACC-080 Non-human identity governance · حاکمیت هویت‌های غیرانسانی
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow Machine Identity Console, JSM service accounts, TOPdesk (API users in permission groups), access research
- **Description:** Every integration, webhook subscriber, connector, MCP client and automation is a principal with explicit grants per resource, action and field, OAuth client credentials or mTLS with short token lifetimes, IP and endpoint/table/field allowlists, and a named owner who certifies it quarterly. A machine-identity score flags unused (90 days), basic-auth, over-privileged and UI+API identities.
- **Implementation:** `principal.kind = integration`; `api_client.certified_at`; scoring job.

#### ACC-081 AI agent identities · هویت عامل‌های هوش مصنوعی
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow (AI user identity), Atlassian Rovo agent accounts, HaloITSM (Application identity), ManageEngine Zia agent roles, access research
- **Description:** Autonomous agents are `ai_agent` principals with explicit minimal grants (read a queue, write category and assignment fields, add internal notes), their own knowledge-source audiences and invocation grants. Actions are attributed to the agent and to the human who triggered or approved them, and everything they create carries provenance flags. There is no shared, broad "AI service account".
- **Implementation:** `principal.kind = ai_agent`; `ai_run.on_behalf_of`; per-agent kill switch (ADM-028).

#### ACC-082 Assist-as-user enforcement · دستیار با مجوزهای همان کاربر
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow (dynamic user, role masking, downstream ACL conjunction), Atlassian Rovo, BMC Helix (company pinning), access research
- **Description:** An assistant acts as its user: allowed = user can ∧ tool allowlist ∧ AI-channel policy. Record-scoped skills read related records only if the user can and, in MSP mode, only inside the record's domain. The requester-facing assistant keeps the requester persona even when the person is also an agent. Triggers may run "as assignee". There is no third identity mode.
- **Implementation:** the AI gateway receives the subject context; role masking = subject grants ∩ skill allowlist.

#### ACC-083 AI-channel policy and data minimisation · سیاست کانال هوش مصنوعی و کمینه‌سازی داده
- **Tier:** P0 · **AI:** yes · **Sources:** Atlassian (data security policies for AI and MCP), Microsoft Restricted Content Discovery and EXTRACT right, ServiceNow Data Privacy for Now Assist, Salesforce Einstein Trust Layer
- **Description:** Per tenant, domain, workspace, resource and classification, the policy decides whether AI may read content and whether it may extract it into answers or only link to it. Defaults: secret and sensitive never; HR and security only in their own partitions and assistants. Personal data is swapped for reversible placeholders before external models; providers and regions are allowlisted; a local-model "no data leaves the network" mode exists; tenant data is never used for training; prompts and outputs have retention limits.
- **Implementation:** scoped `ai_policy` settings (ADM-028) evaluated in the AI gateway; placeholder map per call.

#### ACC-084 Permission-aware retrieval · بازیابی آگاه از مجوز
- **Tier:** P0 · **AI:** yes · **Sources:** Moveworks, Glean, ServiceNow AI Search (early and late binding), BMC HelixGPT, Microsoft 365 Copilot (permission trimming), access research
- **Description:** Chunks per field group carry the record's keys, classification and domain. Retrieval runs vector and keyword search with the subject's compiled predicate in the query (early binding), over-fetches, and re-checks top hits with the record evaluator (late binding) before prompting. Unreadable field groups are never retrieved. Connector content mirrors source ACLs within a freshness window and fails closed when stale, and a nightly job reconciles chunk keys with record keys.
- **Implementation:** `ai_chunk(acl_keys, classification, field_group, domain_id)` (PLT-064); re-key through the outbox.

#### ACC-085 Citation re-check and ACL-keyed answer caches · بازبینی ارجاع‌ها و حافظهٔ پاسخ وابسته به مجوز
- **Tier:** P1 · **AI:** yes · **Sources:** Glean, Microsoft 365 Copilot, ServiceNow (Genius Results only from readable content), access research
- **Description:** Each cited record is re-authorised at render time. Cached and semantic answers are keyed by (tenant, ACL fingerprint, normalised query, source versions) and never shared across subjects unless every source is public. There are no "hidden sources" hints, and answer cards appear only when a readable source exists.
- **Implementation:** ACL fingerprint = hash of the subject's keys and clearances; cache table keyed by it.

#### ACC-086 AI tool permissions and action policies · مجوز ابزارهای هوش مصنوعی و سیاست اقدام
- **Tier:** P0 · **AI:** yes · **Sources:** Freshservice Copilot action policies, ServiceNow (deny-by-default agentic ACLs), InvGate (auto, confirm, never), MCP authorization spec
- **Description:** Every tool declares its required permission, its risk (read, write, destructive or external) and its policy (auto, confirm, approval or blocked, limited by role or group). New and unmapped tools are blocked. Tools run with the user's session or an on-behalf-of token. Writes are structured proposals executed through the normal write path after confirmation. High-risk actions (closing a P1, approving a change, granting a role, bulk updates, external messages) need approval, possibly by someone else. External tools reached through MCP follow the same model.
- **Implementation:** `ai_tool_policy(tool, risk, policy, roles, groups)`; proposals stored by the ai module.

#### ACC-087 Prompt-injection containment · مهار تزریق دستور
- **Tier:** P0 · **AI:** yes · **Sources:** OWASP Top 10 for LLM Applications 2025, ServiceNow Now Assist Guardian, Azure Prompt Shields, dual-LLM and plan-then-execute patterns
- **Description:** Retrieved records, e-mails, attachments and tool outputs enter prompts as labelled data and can never change identity, tool allowlist or policy. A tool-less quarantined reader summarises untrusted text; skills use action-selector and plan-then-execute patterns; outputs are sanitised (no auto-loaded images, links only to allowlisted hosts); an injection classifier runs in log mode, then block mode.
- **Implementation:** AI gateway middleware; classifier skill; outbound host allowlist.

#### ACC-088 AI build, invoke and log permissions · مجوز ساخت، فراخوانی و مشاهدهٔ گزارش هوش مصنوعی
- **Tier:** P1 · **AI:** yes · **Sources:** Atlassian Rovo Studio governance, ServiceNow AI invocation ACLs, BMC HelixGPT admin roles, SysAid (AI Admin permission), Freshservice (log-visibility gap)
- **Description:** Separate permissions cover building agents and skills, invoking each agent (deny by default for new ones; open or named audiences), administering prompts and reading AI conversation logs. Logs inherit the access of the user and records involved, unlike workspace-wide log visibility. Each `ai_run` stores identity, on-behalf-of, retrieved IDs, tool calls, approvals, model and cost.
- **Implementation:** grants on `ai_agent`, `ai_skill` and `ai_run` resources; run rows carry the keys of the records involved.

#### ACC-089 Access explain and view-as debugger · توضیح دسترسی و اشکال‌زدایی آن
- **Tier:** P0 · **AI:** yes · **Sources:** ServiceNow Access Analyzer (evaluate, compare, simulate) and Debug Security Rules, User Criteria Diagnostics, Glean Permissions Checker, access research
- **Description:** For any user and record, `explain` shows each layer with pass or fail: tenant, domain, every restriction, every grant (role, context, scope, matching key), field masks, and for writes the transition, option and SoD rules. "Compare two users" diffs effective access. "Why can't I see this?" answers are narrated by an AI explainer from the deterministic trace; the explainer never decides access.
- **Implementation:** `explain(ctx, resource, id, action)` API; trace view in admin; explainer skill reads the trace.

#### ACC-090 Who-can-see and reverse key index · «چه کسی می‌بیند» و نمایهٔ معکوس کلیدها
- **Tier:** P1 · **AI:** no · **Sources:** Zanzibar family (OpenFGA, SpiceDB), access research
- **Description:** For any record it lists everyone who can read or act on it and why; for any user, what they can see per resource. The same reverse index drives notification fan-out, access reviews and leak investigations.
- **Implementation:** `key_index(key → assignments and memberships)` maintained by the compiler; group expansion, then restriction filtering.

#### ACC-091 Policy simulator and versioned publishing · شبیه‌ساز سیاست و انتشار نسخه‌دار
- **Tier:** P0 · **AI:** no · **Sources:** ServiceNow Access Simulator, access research
- **Description:** Every change to roles, grants, restrictions, audiences, field policies or presets is a draft. The simulator shows who gains and who loses access (counts and samples) on live data before publishing. Publishing needs step-up MFA, plus a second approver for security tables. Versions keep diffs and can be rolled back, and sandbox-to-production promotion carries the same diff.
- **Implementation:** `policy_version(snapshot, diff, simulation_id, published_by, approved_by)`; simulation as a job.

#### ACC-092 Access reviews and certification campaigns · کارزارهای بازبینی و تأیید دسترسی
- **Tier:** P1 · **AI:** yes · **Sources:** ISO/IEC 27001 A.5.18, SOX, ITIL 4, FitSM, ServiceNow, IGA practice, access research
- **Description:** Campaigns per role, group, restricted group, clearance, integration, AI agent or external account go to managers, owners or group leaders. Reviewers see last use, peer access and SoD conflicts, with AI summaries and proposed revocations. Decisions (keep, revoke, modify) apply automatically, unused grants (90 days) are proposed for removal, overdue items escalate, and results become audit evidence.
- **Implementation:** `access_review_campaign`, `access_review_item`; scheduled through PLT-056.

#### ACC-093 Access requests and entitlement catalogue · درخواست دسترسی و کاتالوگ مجوزها
- **Tier:** P0 · **AI:** yes · **Sources:** ITIL 4 (service requests + information security), ISO/IEC 27001 A.5.18, FitSM PR6, COBIT DSS05.04, ServiceNow, Freshservice, Zendesk
- **Description:** An entitlement catalogue lists our roles, groups and clearances plus target-system accounts, applications, shared folders, VPN and data sets, each with an owner. A request goes through owner and authority-matrix approval with SoD checks, then provisioning (automatic through SCIM or directory actions, INT-031, or a manual task), then time-bound expiry and recertification. Grants are reconciled nightly with target systems to flag orphaned or excess access. A conversational agent takes access requests.
- **Implementation:** `entitlement`, `access_grant(subject, entitlement_id, request_id, approver, valid_from, valid_to, status)`; reconciliation job.

#### ACC-094 Access-risk analytics and hardening score · تحلیل ریسک دسترسی و امتیاز سخت‌سازی
- **Tier:** P1 · **AI:** yes · **Sources:** ServiceNow Security Center, Veza access graph, Atlassian Guard detections, access research (role mining, anomalous access)
- **Description:** Detects sudden scope growth, dormant privileged accounts, external users with internal roles, SoD conflicts, basic-auth integrations, AI agents with write tools but no approvals, and unusual record volumes, off-hours bulk reads and repeated denials (modelled per user, integration and agent). Role mining proposes leaner roles. A hardening score per tenant lists checks and accepted risks.
- **Implementation:** nightly analytics over assignments, logs and `ai_run`; anomaly skill; `hardening_check` results.

#### ACC-095 Privileged-action log · گزارش اقدام‌های ممتاز
- **Tier:** P0 · **AI:** no · **Sources:** ISO/IEC 27001 A.8.2 and A.8.15, ITIL 4 (non-repudiation), ServiceNow, Atlassian Guard
- **Description:** Elevation, impersonation, break-glass and support access, policy changes, `asSystem` calls, bulk exports, mass reads, reveals and AI tool calls go to an append-only, hash-chained log with real and effective identity, reason and approvals. The log streams to the tenant's SIEM.
- **Implementation:** `privileged_action_log` chained as in PLT-030; SIEM export via INT-035.

#### ACC-096 Read audit and denial logs · ممیزی مشاهده و گزارش ردِ دسترسی
- **Tier:** P1 · **AI:** no · **Sources:** ITIL 4 (non-repudiation), ISO/IEC 27001 A.8.15, access research
- **Description:** Opening records or revealing fields of flagged classes (HR, security, VIP, sensitive) is logged with viewer, record and purpose. Authorization denials are logged for investigations and anomaly detection. Optionally, people see who opened their own HR case.
- **Implementation:** `read_audit`, `authz_denial_log`; offline journals uploaded on reconnect.

#### ACC-097 Recipient-aware notifications and report delivery · اعلان و ارسال گزارش با رعایت مجوز گیرنده
- **Tier:** P0 · **AI:** no · **Sources:** access research, analytics research (recipients re-checked at send time), JSM (unpermissioned data-share lesson)
- **Description:** Notifications go only to people who can read the record and are rendered under each recipient's field mask, with placeholders for hidden fields. Scheduled reports and subscriptions re-check recipients at send time, webhooks project under the subscriber principal, and exports, print and PDF use the same projection.
- **Implementation:** fan-out through `whoCanSee`; recipient subject context in notification and report jobs.

#### ACC-098 Per-resource default visibility · دید پیش‌فرض هر جدول
- **Tier:** P1 · **AI:** no · **Sources:** Salesforce org-wide defaults, Dataverse, JSM (open vs private team-managed spaces)
- **Description:** For each resource the admin sets a baseline for internal users: private (scoped grants only), public read, or public read and comment. The baseline is a labelled grant to the "all internal users" role, so wide defaults are visible and simulated like any other grant.
- **Implementation:** generated grant rows tagged `baseline`.

#### ACC-099 Extension and script privilege boundaries · مرزهای مجوز افزونه‌ها و اسکریپت‌ها
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow (application access settings, cross-scope privileges, Restricted Caller Access), Atlassian Forge (declared permissions)
- **Description:** Extensions and tenant scripts run as their own principal with table, field and API scopes declared in a manifest and approved at install. Access to HR, security or other protected tables needs an explicit cross-scope privilege, and tenant code gets only permission-checked APIs.
- **Implementation:** extension principal (INT-049); manifest permissions; sandbox API surface (PLT-050).

#### ACC-100 Data security policies · سیاست‌های امنیت داده
- **Tier:** P1 · **AI:** no · **Sources:** Atlassian Guard data security policies, Microsoft Purview DLP, ISO/IEC 27001 A.8.12
- **Description:** Policies per classification, workspace or resource block, or require approval for, export, print, public links, external sharing, attachment download on unregistered devices, offline caching, third-party apps and AI/MCP use, independent of user access. Violations are logged and can open security incidents.
- **Implementation:** `data_security_policy(scope, classification, controls{export, print, public_link, offline, apps, ai})`.

#### ACC-101 Canary leak tests and parity suite · آزمون نشت با رکوردهای قناری و آزمون هم‌خوانی
- **Tier:** P0 · **AI:** yes · **Sources:** access research, OWASP Top 10 for LLM Applications 2025
- **Description:** Canary records (restricted group, HR case, other tenant, other domain, secret field) carry unique marker strings. Suites ask every assistant, agent, search, report, export and MCP tool under many personas to reveal them, and any marker in an output fails the build. A generator writes adversarial questions per persona, and the compiler's parity tests run in the same pipeline.
- **Implementation:** CI suite plus a scheduled production canary check.

#### ACC-102 Policy authoring copilot · دستیار نگارش سیاست دسترسی
- **Tier:** P1 · **AI:** yes · **Sources:** access research, ServiceNow (configuration agents)
- **Description:** Admins describe access in Persian («کارشناسان سایت تبریز فقط درخواست‌های همان سایت را ببینند»), and the copilot drafts roles, grants, restrictions or audiences. Drafts must pass the simulator and approval before publishing.
- **Implementation:** AI skill producing policy drafts as change-set items (ADM-009).

#### ACC-103 Four-eyes control for critical operations · کنترل دونفره برای عملیات حساس
- **Tier:** P1 · **AI:** no · **Sources:** ISO/IEC 27001 A.5.3, Freshservice (leader approval), access research
- **Description:** A second authorised person must approve critical operations: changing SSO or SCIM settings, publishing security policy, exporting all data, deleting a workspace or domain, disabling audit streaming, entering a secure workspace by break-glass. Pending operations expire.
- **Implementation:** `dual_control(operation, requested_by, approved_by, payload_hash, expires_at)`.

#### ACC-104 User invitations and bulk onboarding · دعوت کاربران و ورود گروهی
- **Tier:** P0 · **AI:** no · **Sources:** Freshservice, JSM, ManageEngine SDP, GLPI
- **Description:** Invitations go by e-mail, SMS or messenger with a persona preset, expiry, resend and revoke. CSV/Excel imports create people with anchors and roles, previewed first. Pending invitations and unaccepted accounts are listed and cleaned up automatically.
- **Implementation:** `invitation(channel, address, persona, roles, expires_at, state)`; import through PLT-065.

#### ACC-105 Org-structure import and explorer · ورود و مرور ساختار سازمانی
- **Tier:** P1 · **AI:** no · **Sources:** ServiceNow (organization hierarchies), Ivanti (people hierarchies), GLPI (entity tree), ITIL 4
- **Description:** The org tree comes in from Excel, HR or AD OUs, with mapping of unit kinds. Acting heads («سرپرست») are set with an end date. An explorer shows units, heads, members, groups, locations and cost centers, and "who handles what" per unit.
- **Implementation:** import profile for `org_unit`; `org_unit_head(unit_id, user_id, acting, valid_to)`.

#### ACC-106 Policy as code and external policy export · سیاست به‌صورت کد و خروجی برای ممیزی
- **Tier:** P2 · **AI:** no · **Sources:** ServiceNow (code-first security artefacts), Cedar, OPA, access research
- **Description:** Roles, grants, restrictions and field policies export, diff and import as versioned files. They can also export to Cedar for external audit or formal analysis, so security configuration is reviewable in Git and promotable between environments.
- **Implementation:** serializer over the policy tables; Cedar translator.

#### ACC-107 Relationship-based grants · مجوز مبتنی بر رابطه
- **Tier:** P2 · **AI:** no · **Sources:** Zanzibar, OpenFGA, SpiceDB, ServiceNow CSM (partner relationships)
- **Description:** Dated relationship tuples (partner manages a customer account, contact is responsible for a site, vendor supports a CI class) grant scoped access without new roles. For example, a partner's agents see the cases of the accounts they manage, but none from before the relationship started.
- **Implementation:** `relationship(subject, relation, object, valid_from, valid_to)` compiled into `rel:` keys.

#### ACC-108 National identity verification for external users · احراز هویت ملی کاربران بیرونی
- **Tier:** P2 · **AI:** no · **Sources:** our design (Iranian context: Shahkar mobile-to-national-ID matching, government single sign-on)
- **Description:** Citizen- and customer-facing portals can confirm that a mobile number belongs to the claimed national ID through licensed verification providers, or accept government single sign-on, before high-value requests. The national ID is stored only as a hash-match field.
- **Implementation:** verification connector; result on `user.identity_verified_at`, `identity_verification_method`.

### Data model

Access tables are security configuration. They are readable by the security and user-access admins of their scope and writable only through the access services. Every write bumps `tenant.policy_version` (roles, grants, restrictions, field policies, audiences, rules) or the affected users' `authz_epoch` (memberships, assignments, delegations, elevations, clearances, anchors), passes the simulator for policy tables (ACC-091) and is written to the privileged-action log. `org_id` = tenant; MSP mode adds `domain_id`; physical names are `sm_*`.

**Columns on every secured record** (incident, request, problem, change, release, task, case, CI, asset, article …): `org_id`, `domain_id`, `workspace_id`, `security_level_id`, `restricted_group_id`, `hide_from_requester`, `classification`, `requester_id`, `requested_for_id`, `opened_by_id`, `assignee_id`, `assignment_group_id`, `owner_group_id`, `company_id`, `org_unit_id`, `location_id`, `cost_center_id`, `service_id`, `project_id`, `acl_keys text[]` (GIN), `acl_version`, `external_visible`. Requester anchors are snapshotted at creation; assignment and service anchors are live. Clients never write `acl_keys`, domain, level, classification or audit columns.

| Table | Key fields | States (category) | Prefix | Relationships | Access scoping |
|---|---|---|---|---|---|
| `principal` | kind (user, group, integration, ai_agent, anonymous, break_glass), domain_id, status | active, suspended (waiting), deactivated (closed) | — | user, group, api_client | security admins; display through the directory grant |
| `user` (= `sm_users` + `sm_org_members`) | kind (internal, external, integration, ai_agent), persona, company_id, org_unit_id, location_id, cost_center_id, manager_id, resource_pool_id, vip, auth_policy_id, max_offline_hours, login_modes, authz_epoch, external_id, scim_source, licence_state, identity_verified_at | invited (new) → active → suspended (waiting) → deactivated (closed) | — | anchors, manager | self; directory grant (ACC-002); user-access admins of the administrable set |
| `company` | kind (internal, customer, vendor, partner, manufacturer), parent_id, domain_id, code | active, inactive (closed) | — | tree_closure | company / company-subtree scopes; admins |
| `org_unit`, `org_unit_head` | kind, parent_id, company_id, cost_center_id, code / unit_id, user_id, acting, valid_to | active, inactive (closed) | — | company, cost center | internal users read the tree; unit or tenant admins edit |
| `location` | kind, parent_id, address, time_zone, geo, primary_contact_id | active, inactive (closed) | — | tree_closure | internal read; site admins edit |
| `cost_center`, `resource_pool` | parent_id, owner_user_id / parent_id, manager_user_id | active, inactive (closed) | — | tree_closure | finance owners / planners of the subtree |
| `tree_closure` | tree, ancestor_id, descendant_id, depth | — | — | all anchor trees | maintained by triggers only |
| `group`, `group_member` | types[], parent_id, restricted, leader_approval, workspace_id, domain_id, manager_id, email, rule / kind (member, observer, leader), valid_from, valid_to, source, granted_by, reason | group active, inactive; membership pending_approval (waiting) → active → expired (closed) | — | users, roles, workspace | members and leaders; restricted groups change only with leader approval |
| `customer_org`, `customer_org_member` | name, email_domains[], company_id, sharing / user_id, is_admin | active, inactive (closed) | — | company, users | organization admins; agents of the account |
| `workspace`, `workspace_member` | kind, secure, domain_id / principal_id, role_id | setup (new) → live (active) → archived (closed) | — | groups, roles | members; secure workspaces explicit members only |
| `domain`, `domain_visibility` | parent_id, path, kind (root, provider, customer, process, data) / subject_id, domain_id, kind (visibility, contains) | active, retired (closed) | — | companies, configuration | domain admins; cross-domain visibility by the tenant security admin |
| `role`, `role_contains` | key, name, internal_only, external_allowed, elevated, assignable_by_role_id, licence, delegable, system, version | draft (new) → published (active) → retired (closed) | — | grants, assignments | security admins; user-access admins read |
| `grant`, `security_attribute` | role_id, resource, action, scope, condition, field_set_id, baseline / key, condition | versioned with the role | — | role | security admins |
| `role_assignment` | principal_id, role_id, context_type, context_id, recursive, valid_from, valid_to, source, granted_by, reason, last_used_at | pending (new) → active → expired (closed); revoked (canceled) | — | principal, role, context node | own; user-access admins of the administrable set |
| `provisioning_rule`, `scim_mapping` | match, actions[], priority, last_run / idp_id, external_group, group_id, role_id, context | draft (new) → active → disabled (closed) | — | roles, groups, audiences | security admins |
| `restriction`, `clearance` | kind, resources[], applies, active / principal_id, restriction_id, level_id, valid_to, source, granted_by | active, inactive; clearance active → expired (closed) | — | records | security admins; holders see their own clearances |
| `security_scheme`, `security_level`, `classification_label` | resources / scheme_id, name, rank / rank, key, labels{fa,en}, colour, defaults | active, retired (closed) | — | records | labels readable by all; security admins edit |
| `audience`, `audience_binding` | include, exclude, match_all / object_type, object_id, mode, audience_id | active, inactive (closed) | — | KB, catalog, request types, announcements, AI sources | object owners for their bindings; admins |
| `share` | resource, record_id, principal_id, access, reason (participant, approver, cab, handoff_grace, org_share, broadcast, manual), expires_at, created_by | active → expired (closed); revoked (canceled) | — | record, principal | visible to readers of the record; created with the `share` action |
| `option_rule`, `transition_rule` | resource, match, field, mode, values, priority, stop / from_state, to_state, required_action, condition | active, inactive (closed) | — | resource state model | configuration admins through the simulator |
| `sod_rule`, `sod_violation` | kind (static, dynamic), left, right, mode / rule_id, subject_id, target, decision, justification, decided_by | violation open (new) → blocked / accepted (closed) | SOD | records, assignments | security admins; auditors read |
| `authority_matrix`, `authority_level` | resource, dimensions, version / level, condition, approver_rule, threshold, currency | draft (new) → published (active) → retired (closed) | — | approval rules | process owners; auditors read |
| `field_policy`, `field_grant` | resource, field, class, mask, query_ops, ai, offline, search, export / role_id, field_or_class, read, write, unmask, query_range | versioned with policy | — | resource, role | security admins |
| `data_security_policy` | scope, classification, controls{export, print, public_link, offline, apps, ai} | active, inactive (closed) | — | classifications | security admins |
| `delegation`, `absence` | delegator_id, delegate_id, kinds[], condition, valid_from, valid_to, exclude_confidential / user_id, starts_at, ends_at, source | scheduled (new) → active → expired (closed); revoked (canceled) | DLG | users, approvals, records | delegator, delegate, admins |
| `elevation` | user_id, role_id, context, reason, approved_by, mfa_at, starts_at, ends_at | requested (new) → approved (waiting) → active → expired (closed); rejected / revoked (canceled) | ELV | user, role | requester, approvers, security admins, auditors |
| `support_grant`, `dual_control` | vendor_user_id, scope, approved_by, starts_at, ends_at / operation, requested_by, approved_by, payload_hash, expires_at | requested (new) → active / approved → expired (closed); revoked / rejected (canceled) | SPG | tenant | tenant admins, auditors |
| `device` | user_id, platform, registered_at, last_sync_at, wipe_requested_at, key_ref | registered (active) → wipe_requested (waiting) → wiped / retired (closed) | — | user | own; device admins |
| `idp_connection`, `auth_policy`, `stepup_requirement`, `portal_access_policy` | protocol, metadata, domains, cohort, jit_mapping / cohort, idle, absolute, mfa, ip_ranges, zones, max_offline_hours / action_class, max_age, level / portal, mode, signup, verification | configured (new) → active → disabled (closed) | — | users, portals | security admins |
| `mfa_factor`, `session`, `signin_event` | user_id, kind, credential, last_used_at / user_id, device_id, ip, created_at, last_seen_at, expires_at, revoked_at, acting_as / user_id, ip, network, result, risk | session active → expired / revoked (closed) | — | user, device | own; security admins |
| `signature` | resource, record_id, signer_id, meaning, method, signed_at, hash | — (immutable) | — | record | readers of the record |
| `invitation` | channel, address, persona, roles, expires_at, invited_by | pending (new) → accepted (closed); expired / revoked (canceled) | — | user | user-access admins |
| `jml_event` | user_id, kind (joiner, mover, leaver), source (hr, scim, directory), effective_at, actions[], completed_at | received (new) → processing (active) → done (closed); failed (waiting) | — | user, flows, devices, assets | user-access admins; auditors |
| `entitlement`, `access_grant` | kind (role, group, clearance, target_system), target, owner_id, approval_policy, max_duration / subject_id, entitlement_id, request_id, approver_id, valid_from, valid_to, status, reconciled_at | requested (new) → active → expiring (waiting) → expired / revoked (closed) | AGR | request items, users, connectors | entitlement owners; subjects see their own; reviewers |
| `access_review_campaign`, `access_review_item` | scope, reviewers, due_at / campaign_id, subject_id, assignment_or_grant, last_used_at, ai_recommendation, decision, decided_by | campaign draft (new) → running (active) → closed; item pending (waiting) → kept / revoked (resolved) | ARC | assignments, grants | reviewers for their items; campaign owners; auditors |
| `policy_version` | snapshot, diff, simulation_id, published_by, approved_by, published_at | draft (new) → simulated (waiting) → published (closed); rolled back (canceled) | POL | policy tables | security admins; auditors |
| `key_index` | key, source_kind, source_id, subject_ids | — | — | compiler | system only; read through the who-can-see API |
| `privileged_action_log`, `read_audit`, `authz_denial_log` | actor, effective_actor, action, target, reason, approvals, prev_hash, hash / viewer_id, record, fields, purpose / subject_id, resource, record_id, action, failed_layer | append-only | — | records, principals | auditors and security admins; HR read audit for the HR COE |
| `dlp_finding`, `hardening_check`, `access_risk_finding` | record, field, kind, action / check, result, accepted_risk / kind, subject_id, score, evidence | open (new) → resolved / accepted (closed) | — | records, principals | security analysts |
| `ai_tool_policy` | tool, risk, policy, roles, groups | active, blocked (closed) | — | AI tools, agents | AI admins (ADM-028) |
| `relationship` (P2) | subject, relation, object, valid_from, valid_to | active → expired (closed) | — | principals, records | security admins |

### KPIs

| KPI | Formula | Source |
|---|---|---|
| Leaver revocation time | mean and p95 of (access_revoked_at − termination_effective_at); share revoked the same day | ITIL 4, ISO/IEC 27001 A.5.18 |
| Access requests within target | access requests fulfilled ≤ target ÷ access requests fulfilled; p50 / p95 cycle time | ITIL 4, COBIT DSS05.04 |
| Recertification completion | review items decided by the due date ÷ items in the campaign | ITIL 4, ISO/IEC 27001 A.5.18 |
| Review revocation rate | items revoked ÷ items reviewed (near zero suggests rubber-stamping) | ITIL 4, access research |
| Orphan accounts | active accounts with no active HR, IdP or owner source (target 0) | ITIL 4 |
| Dormant privileged accounts | principals with elevated or admin roles unused for 90 days | access research |
| Standing privilege ratio | holders of elevated roles through standing (non-JIT) assignments ÷ holders of elevated roles (target 0) | Microsoft Entra PIM practice, access research |
| Privileged assignments with expiry | elevated or admin assignments with `valid_to` ÷ such assignments | ITIL 4 |
| Phishing-resistant MFA coverage | active agents and admins with a passkey or certificate factor ÷ active agents and admins | NIST SP 800-63B-4 |
| SSO coverage | interactive sign-ins through SSO ÷ interactive sign-ins | Atlassian Guard |
| SoD conflicts | open static conflicts (count); dynamic violations blocked ÷ attempted; overrides with justification (count) | ISO/IEC 27001 A.5.3, ITIL 4 |
| Access denial rate | authorization denials per 1,000 requests, by subject kind (spikes are a security signal) | access research |
| Sensitive-access anomalies | flagged anomalous reads ÷ 1,000 reads of flagged classes | ITIL 4 |
| Policy rollback rate | policy versions rolled back within 7 days ÷ versions published | our design |
| Re-key lag | p95 of (key change committed → search, vector and sync updated) | access research |
| Key drift | records whose stored keys differ from recomputed keys at reconciliation (target 0) | access research |
| Leak-test failures | canary markers found in outputs per CI run; compiler parity mismatches (both target 0) | access research |
| Integration certification | integration principals certified in the last 90 days ÷ integration principals | ServiceNow (Machine Identity Console) |
| Break-glass review completion | break-glass uses with a completed post-use review ÷ uses | Microsoft Entra guidance |
| Impersonation transparency | impersonation sessions with a reason ÷ sessions; write impersonations (count) | access research |
| Offline exposure | devices past the maximum offline period; median time from lost-device report to wipe | access research |
| Sensitive data in free text | DLP findings per 1,000 records; median time to mask | access research |
| AI tool governance | denied AI tool calls ÷ AI tool calls; approval-required AI actions approved ÷ requested | access research, Freshservice |
| Hardening score | passed applicable checks ÷ applicable checks (accepted risks listed apart) | ServiceNow Security Center |

### Beyond the market

- **Permission-exact offline Windows replica.** Access keys double as sync buckets, with restrictions and field classes folded in, so a laptop holds exactly what its user may read and is wiped when access ends; no studied ITSM tool does this.
- **One policy, three compiled forms, proven equal.** CI parity tests and canary leak tests keep lists, counts, search, vectors, sync, notifications, MCP and AI from drifting apart.
- **Iranian organisational reality out of the box.** Unit kinds «معاونت، اداره کل، اداره», acting heads («سرپرست») with end dates, «حراست» as a secure workspace, the national document-classification scheme («عادی» to «به‌کلی سری») as labels, and authority matrices in Rials with deputy levels.
- **Persian identifiers protected properly.** National ID, Sheba and card numbers are detected in free text, masked, encrypted and findable only by hash-match.
- **On-premises identity first.** Active Directory with Kerberos, AD FS, Keycloak and FreeIPA, local passkeys, smart cards from Iran's licensed CAs for e-signatures, SMS or messenger OTP only for external users, and break-glass that works while the IdP is down.
- **Explainable in Persian.** "Why can't I see this?" is answered in Persian from the deterministic trace, and admins draft policy in Persian sentences that must pass the who-gains/who-loses simulator.
- **AI that never exceeds its user, even on a local model.** The AI-channel policy per classification, early and late binding, proposal-only writes and kill switches apply equally to cloud and on-premises models.
- **Fixes for known gaps.** Restricted groups on every record type (not only tickets), explicit hand-off grace instead of hidden last-changer rules, aggregate-only grants for executives, and AI logs that inherit record access.
- **National identity verification** (mobile-to-national-ID matching) for citizen-facing government service desks.

## Deliberately excluded

- **Unsecured server-side data APIs for tenant code** (ServiceNow `GlideRecord`, BMC AR System filters). Tenant scripts that bypass permissions are the most common cause of leaks; tenant code gets only permission-checked APIs (ACC-099), and `asSystem` is for core code only (ACC-051).
- **Post-query row filtering with "rows removed" messages** (ServiceNow post-query ACLs and the Data Filtration feature it is retiring). It gives wrong counts and allows inference; we filter before the query (ACC-052).
- **Admin implies data access** (classic instance admins). Admin roles configure; data access comes only from data grants, and restrictions outrank admins (ACC-024, ACC-028).
- **Shared, broadly privileged AI service accounts.** Replaced by assist-as-user and minimal agent identities (ACC-081, ACC-082).
- **Automations running with full system privileges** (Freshservice Workflow Automator, supervisor rules). Flows run as named principals (ACC-051).
- **Unpermissioned BI data shares** (JSM Data Lake "unpermissioned" connections, Enterprise data shares). Every analytical feed keeps row-level security (INT-034).
- **Client-side rules as security.** UI policies are UX only; the server enforces field locks and option rules (ACC-038, ACC-046).
- **Security questions, forced periodic password changes and SMS OTP as the only factor for agents and admins.** NIST SP 800-63B-4 advises against them; SMS and messenger OTP stay for external users only (ACC-070, ACC-072).
- **Write impersonation by default.** View-as is read-only; write impersonation is a separate elevated permission (ACC-065).
- **Basic authentication for new integrations.** Only OAuth, mTLS or scoped tokens; legacy basic auth survives only in the credential store, flagged by the hardening score (ACC-080).
- **Hidden visibility rules** (TOPdesk last-changer visibility, JSM restricted request types disappearing from every channel). Replaced by explicit hand-off grace and per-channel public fallback (ACC-035, ACC-040).
- **A general-purpose low-code application IDE with arbitrary server code** (ServiceNow App Engine Studio and Fluent SDK, delegated development of arbitrary apps). Outside ITSM scope; custom record types, flows, sandboxed expressions and governed extensions cover tenant needs (PLT-005, PLT-046, PLT-050, INT-049).
- **Proprietary legacy workflow and form languages** (BMC AR System active links, filters and Developer Studio). Replaced by one condition language and the flow designer.
- **A separate mobile app builder** (ServiceNow Mobile App Builder). Phones use the PWA and native apps generated from the same metadata (PLT-074, PLT-075).
- **Being an identity provider, a full IGA suite or a privileged-password vault** (Okta, SailPoint, CyberArk). We consume SSO and SCIM, offer entitlement requests, reviews and reconciliation for connected systems, and integrate with those products instead of replacing them (ACC-069, ACC-075, ACC-093).
- **Our own PBX, video-conferencing server or general-purpose iPaaS.** We integrate with Asterisk/Issabel, Skyroom/BigBlueButton and external iPaaS (INT-020, INT-021, INT-051).
- **Blockchain or distributed-ledger audit.** Hash chains with daily anchors on WORM storage give the same tamper evidence at a fraction of the cost (PLT-030).
- **Training vendor models on tenant data or a vendor-only hosted LLM.** Tenants bring their own model, cloud or local, and their data is never used for training (INT-040, ACC-083).
- **One instance per customer as the only isolation model.** We run multi-tenant with RLS and offer dedicated deployments when isolation, own keys or residency require them (ACC-054, ADM-024).

## Engine requirements

Capabilities the shared platform engine must provide for this group, and that every other module relies on:

1. **Metadata registry** (`TableDef`): tables, fields with field classes, choices, references, state models with categories, numbering prefixes, scope fields for access keys, feature flags per table (journal, attachments, RAG, sync, SLA, approvals, audit); custom tables and fields at runtime; versioned record models.
2. **Condition AST** compiled to SQL (Postgres and PGlite) and to JavaScript, with subject and environment variables, named predicates and Jalali-aware date operators; used by filters, rules, SLA, notifications, grants, restrictions, audiences, option rules, flows and AI tool policies.
3. **Record service write path**: one transaction that checks grants, field grants and state locks, transition rules, option rules, SoD and the post-image scope; derives keys, writes history and audit (hash chain), and emits outbox events; optimistic concurrency and idempotency keys.
4. **Access provider**: subject context cached by `authz_epoch` and `policy_version`; `compileRead`, `evaluate` and `deriveKeys` with property-based parity tests; key trigger and re-key jobs; RLS backstop with tenant and domain fences; `explain`, `whoCanSee`, view-as and the policy simulator; field-mask projection reused by API, exports, notifications, search, sync and AI.
5. **Transactional outbox, event bus and job queue** with lanes, fair claiming per tenant and connection, retries, dead letters and replay; scheduled jobs; `asSystem(reason)` as the only privileged context.
6. **Timer engine with business calendars**: Jalali dates and fiscal periods, Iranian official and ad-hoc holidays, per-site calendars, pause and resume, used by SLA, reviews, regulatory clocks, delegation and access expiry.
7. **Flow runtime, decision tables and approval engine**: run-as principals, authority matrix, delegation, SoD checks, step-up and e-signature on decisions, approvals from portal, e-mail, SMS and messengers.
8. **Notification engine** rendering per recipient under that recipient's field mask, with fan-out through `whoCanSee`, channel adapters (e-mail, SMS, Bale, Eitaa, Telegram, push) and preferences.
9. **Search and RAG indexing**: Persian normalisation, field-group chunks carrying access keys, classification and domain; early and late binding; re-key through the outbox; freshness windows for connector content.
10. **Sync engine**: access-key buckets with restriction folding, field-class side tables, working sets, encrypted local store, device registry, revocation and wipe, offline writes as proposals.
11. **Configuration lifecycle**: settings hierarchy with domain, workspace, company and site overrides; versioning, diff, change sets, sandbox promotion, simulation and rollback; four-eyes approval for critical operations.
12. **Identity and authentication services**: OIDC, SAML and Kerberos SSO; passkeys, TOTP and certificate MFA; step-up; sessions and network zones; SCIM server; OAuth 2.1 authorization server with token exchange; API tokens and app registrations.
13. **Integration runtime**: connector framework with typed actions, credential vault (envelope encryption, per-tenant keys, optional customer-managed keys), inbound and outbound webhooks, rate limits, the on-premises relay, field mappings and external references, MCP server and client.
14. **AI gateway**: provider routing with bring-your-own and local models, AI-channel policy, PII placeholders, tool policies with proposals, prompt-injection containment, `ai_run` logging, budgets and kill switches.
15. **Import, export and bulk operations** under the caller's permissions, with AI-assisted mapping, previews, rollback and data-security policies.
16. **Observability and audit**: privileged-action log, read audit, denial log, SIEM streaming, health metrics, usage metering and limits.
17. **Internationalisation**: RTL-first UI kit, Persian and English (plus further locales) for UI and content, Persian digits, Jalali calendars and official-letter print layouts.
