# Configuration management (CMDB/CSDM), IT asset management (HAM/SAM/SaaS), service portfolio, suppliers and contracts, IT financial management

This catalogue consolidates five modules of the platform from every research report (ITIL 4/5, ISO/IEC 20000, 19770, 27001, 22301, NIST CSF 2.0, COBIT, FitSM, IT4IT, VeriSM, SIAM, TBM, FinOps FOCUS, EU DORA, ISO 55001, ISO 44001; ServiceNow, Jira Service Management, Freshservice, BMC Helix, ManageEngine ServiceDesk Plus, Ivanti, SysAid, HaloITSM, TOPdesk, Xurrent, SMAX, EasyVista, InvGate, Zendesk, Atera, GLPI, iTop, Snipe-IT, NetBox and AI-native desks). Duplicate capabilities across tools were merged into one feature; distinct variants were kept apart.

**How to read a feature.** Each feature has an id, English and Persian names, tier, AI flag, sources, a "What and how" description (fields, states, rules, UI) and "Build notes" for our architecture (metadata record engine, condition language, state models, SLA, approvals, notifications, flows, jobs, RAG, AI skills/agents and special UI). Tiers: **P0** = must have for an enterprise ITSM v1; **P1** = strong differentiator we should build; **P2** = later/optional. **AI = yes** means the feature contains an AI component (the arithmetic is always done in code; models narrate, classify, extract or propose, and every AI write is a proposal unless the tenant enables autonomy).

**Cross-module design decisions.**
- **Asset ≠ CI.** The asset (ITAM) is the financial/contractual record, the CI (CMDB) the operational record; they are linked 1:1 where both exist and synchronized with a master per field (ITAM-002).
- **Services are CIs.** A `service` row is a 1:1 portfolio extension of a service CI, so impact analysis, SLAs, the catalogue and costs share one identity (SPF-001, SPF-009).
- **One organization directory and one contract table.** Manufacturers, vendors, publishers, partners and customers are rows of `organization`; every contract type (UC, warranty, lease, licence, subscription, cloud, NDA) is a row of `contract`, owned by the supplier module and referenced by ITAM, SLM and finance.
- **Procurement lives in ITAM** (requisition → PO → receipt → asset), with spend authority and invoices in finance.
- **Depreciation is calculated in ITAM** (ITAM-042) and **posted in finance** (FIN-007); cloud cost and FinOps live in finance, cloud resources as CIs in the CMDB.
- **One write path into the CMDB** — the identification and reconciliation engine (CMDB-023) — for discovery, connectors, imports and APIs.
- **Money is field-secured everywhere** (field group `financial`), including exports, search, offline replicas and AI prompts.

**Boundaries with other module groups.** SLA/OLA/UC timers and SLA definitions belong to service-level management (we generate them from commitments and contracts); catalogue items and request fulfilment to the request module; vulnerabilities and the risk register to security; BIA, outages and continuity plans to continuity; projects, demand, strategy depth and benefits to the project/portfolio module; generic lists, forms, imports, flows, notifications and analytics to the platform engine.

## Summary

| Module | Persian title | Features | P0 | P1 | P2 | With AI |
|---|---|---|---|---|---|---|
| `cmdb` (CMDB-) | مدیریت پیکربندی (CMDB/CSDM) | 79 | 19 | 45 | 15 | 11 |
| `itam` (ITAM-) | مدیریت دارایی‌های فناوری اطلاعات (سخت‌افزار، نرم‌افزار، SaaS) | 79 | 22 | 41 | 16 | 17 |
| `service_portfolio` (SPF-) | سبد و کاتالوگ خدمات | 43 | 9 | 21 | 13 | 7 |
| `supplier` (SUP-) | تأمین‌کنندگان و قراردادها | 46 | 10 | 20 | 16 | 5 |
| `financial` (FIN-) | مدیریت مالی فناوری اطلاعات | 45 | 7 | 25 | 13 | 7 |
| **Total** | | **292** | **67** | **152** | **73** | **47** |

## Module: cmdb — مدیریت پیکربندی (CMDB/CSDM)

### Features

#### CMDB-001 — CI class hierarchy and Class Manager
- **Persian name:** سلسله‌مراتب کلاس‌های CI و مدیریت کلاس‌ها
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (CI Class Manager), JSM Assets (object types), Freshservice (asset types), BMC Helix (Common Data Model), ManageEngine SDP (CI types), iTop (data model), ISO/IEC 20000-1 §8.2.6, COBIT BAI10.01, FitSM PR11
- **What and how:** Admins define CI classes as metadata in a tree: abstract parents that cannot hold CIs, attribute inheritance down the tree, a label (display) attribute, icon, "principal class" flag (classes that count for health and reporting), "creation disabled" flag, copy-class and a class-model graph view. Each class carries its attributes (any engine field type, including references with cardinality and filter, unique values, regex, suffix, show-sum), identification and reconciliation rules, health settings, suggested/required relationships, its lifecycle model and the asset class it maps to. System key and display label are separate, so renaming never breaks queries. Class changes are versioned and audited.
- **Build notes:** `ci_class` config records (key, parent_key, abstract, label_attr, icon, principal, create_disabled, attrs FieldDef[] json, lifecycle_model, health_cfg, rel_rules, asset_class); closure table for "all descendants of"; CI attribute values live in `ci.attrs` jsonb validated against the merged inherited definition, hot attributes promoted to indexed generated columns; only additive changes, removed attributes are archived.

#### CMDB-002 — Prebuilt CSDM-aligned class library
- **Persian name:** کتابخانهٔ آمادهٔ کلاس‌ها، هم‌راستا با CSDM
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (CSDM 5), JSM (Assets common data model, schema templates), Freshservice (default asset types), BMC (CDM), iTop, InvGate, ITIL 4, NIST CSF ID.AM
- **What and how:** A ready class pack so tenants never start empty: hardware (computer → desktop, laptop, server; mobile; printer; monitor; network gear → router, switch, firewall, access point, load balancer; storage; rack, PDU, UPS), software (application, software instance, database, middleware, web server), cloud (account, region, VM, network, bucket, managed database, container, Kubernetes cluster and namespace, serverless function), logical items (environment, cluster, IP network, LB pool), the service layer (business service, technical service, service offering, service instance, business application, business capability), information assets, certificates, AI systems, documents and facilities, plus references to people, locations and organizations. Packs can be enabled per workspace (IT, Facilities, HR) and come with a staged CSDM adoption path (foundation → crawl → walk → run).
- **Build notes:** Versioned seed data for `ci_class` and `ci_rel_type`; tenant customisations stored as deltas over the pack (iTop-style), so pack upgrades merge cleanly.

#### CMDB-003 — Common CI attributes and minimum record
- **Persian name:** ویژگی‌های مشترک CI و حداقل رکورد الزامی
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (cmdb_ci), Freshservice (asset fields), BMC, ManageEngine SDP, ISO/IEC 20000-1 §8.2.6, ITIL 4, FitSM PR11, ISO/IEC 27001 A.5.9
- **What and how:** Every CI carries: number, name, class, description, serial number, asset tag, model, manufacturer, owner (owned by), managed by, managed-by group, support group, change-approval group, company, owning unit, location, cost centre, environment (production, test, development, DR), criticality and service tier, operational status, install status, lifecycle stage, discovery source, first/last discovered, maintenance schedule, domain, tags and sustainability attributes (power draw, carbon factor). The ISO/IEC 20000 minimum (unique id, type, description, relationships, status) is enforced, and an owner is mandatory for classes the scope policy marks as owned.
- **Build notes:** Core columns on `ci` plus engine base columns (workspace_id, domain_id, unit_id); owned_by, support_group_id, managed_by_group_id, location_id and company_id are declared as scope anchors in the table's scope profile; per-class mandatory fields are UI policies re-checked on the server.

#### CMDB-004 — CI lifecycle and status model
- **Persian name:** چرخهٔ عمر و وضعیت‌های CI
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (life cycle stage/status, CI Lifecycle Management API), ManageEngine SDP (Active / End-of-Life, bulk state change), JSM (statuses with categories), ITIL SCM (CI lifecycle model), standards (status lifecycle)
- **What and how:** Three separate fields: lifecycle stage (planned → on order → build → test → operational → maintenance → end of life → retired → disposed), operational status (operational, non-operational, repair in progress, DR standby, ready) and install status. Per-class state models add transition guards (e.g. operational needs an owner and a support group). A lifecycle API lets other modules (change, discovery, ITAM) request maintenance or retirement with conflict control. Retired CIs keep their effective-dated relationships for history, are hidden from pickers by default and can be changed in bulk.
- **Build notes:** `ci.state` holds the lifecycle stage (categories: planned=new, on_order=waiting, build/test/operational/end_of_life=active, maintenance=waiting, retired/disposed=closed, canceled=canceled); operational_status and install_status are choice fields; per-class StateModel overrides; lifecycle requests are logged with the requesting actor.

#### CMDB-005 — Typed directional relationships
- **Persian name:** روابط نوع‌دار و جهت‌دار
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (cmdb_rel_ci), Freshservice (relationship types), JSM Assets (references, global reference types), BMC, ManageEngine SDP (association types), iTop, ITIL 4 (service model), ISO/IEC 20000-1
- **What and how:** A registry of relationship types, each with a forward and an inverse label: Depends on/Used by, Runs on/Runs, Hosted on/Hosts, Contains/Contained by, Connects to (symmetric), Member of/Includes, Provides/Consumes, Backs up/Backed up by, Fails over to, Virtualizes, Sends data to/Receives data from, Exchanges data with, Impacts/Impacted by, Supports, Managed by, Located in, Owned by, Subscribed by. Each type has a colour, a symmetric flag and impact behaviour; admins add custom types (name + inverse). Relationships record their source and discovered/last-seen times and can also link a CI to non-CI entities (users, groups, departments, locations, suppliers, contracts).
- **Build notes:** `ci_rel_type` (key, fwd_label, inv_label, symmetric, propagates, impact_direction, color) and `ci_rel` (parent_ci_id, child_ci_id, type, source_id, origin manual|discovery|rule|ai, discovered_at, last_seen_at, valid_from, valid_to, impact_weight) indexed both ways; links to non-CI records use the engine's generic typed links.

#### CMDB-006 — Relationship rules and suggested relationships
- **Persian name:** قواعد روابط و روابط پیشنهادی هر کلاس
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (suggested relationships, dependent-class rules), JSM (reference cardinality), BMC (Data Monitor relationship rules), ManageEngine SDP (orphan policy)
- **What and how:** For each class pair the admin sets allowed relationship types, required relationships ("an application instance must run on a host"), cardinality limits and what counts as an orphan. The CI form proposes the suggested relationships when a CI is created or edited, and violations feed the correctness score (orphans) and data-quality findings.
- **Build notes:** `ci_class.rel_rules` json (type, target_class, direction, min, max, required); soft warnings in a `beforeWrite` hook, hard findings from nightly health jobs.

#### CMDB-007 — Rule-based relationship creation
- **Persian name:** ایجاد خودکار روابط با قاعده
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (condition-based automations create relationships), ServiceNow (dependent identification), iTop (synchro)
- **What and how:** Rules create and retire relationships from attribute matches: VM.host_uuid = hypervisor.uuid → Runs on; software instance hostname = server name → Runs on; CI location → Located in. Rules run on every reconciliation commit and nightly; relationships they create are marked origin = rule and are closed when the match no longer holds.
- **Build notes:** `ci_rel_rule` (source_class, target_class, match condition over both rows, rel_type, mode create|create_and_retire) executed by a job over changed CIs from the outbox, with idempotent keys.

#### CMDB-008 — Effective-dated relationships and point-in-time graph
- **Persian name:** روابط تاریخ‌دار و نمای گراف در یک لحظهٔ گذشته
- **Tier:** P1 · **AI:** no
- **Sources:** standards (effective-dated relationships; "what was affected then?"), ITIL 4, EU DORA
- **What and how:** Relationships get valid-from/valid-to dates instead of being deleted, so the graph can be shown "as of" any moment: incident and audit views show what was connected when the incident happened, and post-implementation reviews compare the graph before and after a change.
- **Build notes:** `ci_rel.valid_from/valid_to`; traversal functions take an `as_of` parameter; attribute values at time T are rebuilt from `sm_history`; closure caches cover only "now".

#### CMDB-009 — Relationship editor canvas and bulk relationships
- **Persian name:** بوم ویرایش روابط و ثبت گروهی روابط
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (drag-and-drop relationship canvas, hide from map, list layout), Freshservice (bulk relationship API with async job), JSM (object graph)
- **What and how:** A drag-and-drop canvas to add and remove relationships between CIs, with a list layout as an alternative, a per-relationship "hide from map" option, and bulk creation or deletion of relationships from CSV or API, run as an asynchronous job with per-row results.
- **Build notes:** Client component on the shared graph widget; bulk work as a job with a result report; every write goes through the record service so the `edit_relations` right is checked.

#### CMDB-010 — Interactive dependency and impact map
- **Persian name:** نقشهٔ تعاملی وابستگی و اثر
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (dependency views, Unified Map), JSM (service graph, object graph), Freshservice (relationship map, Device42 maps), ManageEngine SDP (relationship map), BMC (CMDB Explorer), iTop (impact graph), analytics (dependency map pattern)
- **What and how:** A graph centred on a CI or service: expand neighbours one level at a time; filter by relationship type, class, depth and direction; overlay open incidents, changes, alerts, outages and vulnerabilities; highlight the upstream/downstream blast radius. Layered (top-down service) and force layouts, clustering above about 200 nodes, minimap, PNG/SVG export and an accessible table view. It opens in a workspace tab from any record and labels read correctly in RTL.
- **Build notes:** Endpoint `graph(ci_id, depth, types, direction, as_of)` returns nodes and edges after per-node access filtering (CMDB-076); the client renders with ELK/dagre layouts and lazy loading; overlays come from aggregate queries on task tables.

#### CMDB-011 — Impact analysis
- **Persian name:** تحلیل اثر
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (impacted services), ManageEngine SDP (CI impact analysis), BMC (impact relationships), JSM (affected services, blast radius), Freshservice, iTop, ITIL 4
- **What and how:** For one or more CIs, computes the services, offerings, users, SLAs and critical functions that depend on them, with the impact path and a table of source and destination CIs. Incidents fill "impacted services" automatically, changes use the result for risk and approvals, event management uses it for topology correlation and problems for scope.
- **Build notes:** Bounded breadth-first search over relationship types with propagates = true, in their impact direction, with depth cap and cycle guard; materialized `ci_service_closure(service_ci_id, ci_id, depth)` refreshed by a job when relationships change; exposed to incident/change hooks and AI tools.

#### CMDB-012 — Impact propagation rules and redundancy
- **Persian name:** قواعد انتشار اثر و افزونگی
- **Tier:** P1 · **AI:** no
- **Sources:** iTop (redundancy N of M, Flow class propagation flags), BMC (impact normalization: impact as relationship attributes), Freshservice (impacting relationship types)
- **What and how:** Impact propagation is configurable: per relationship type (propagates or not, direction, weight) and per redundancy group (a cluster or farm is down only when more than N of its M members are down, or when fewer than x% are up). Data-flow records can carry their own propagation flag. This prevents false impact, such as one cluster node failing being reported as a service outage.
- **Build notes:** `ci_rel_type.propagates/impact_direction`, `ci_rel.impact_weight`, `ci_group.min_up` or `min_up_pct` for redundancy groups; the impact algorithm evaluates group state before propagating; closures are invalidated on change.

#### CMDB-013 — What-if impact simulation
- **Persian name:** شبیه‌سازی اثر («اگر … چه می‌شود»)
- **Tier:** P1 · **AI:** no
- **Sources:** BMC (impact simulation in change and incident), Freshservice (predictive impact analysis), ServiceNow (change impact)
- **What and how:** Pick CIs and a hypothetical state (down, degraded, in maintenance) and see the affected services, offerings, users and subscribers, SLAs at risk, critical functions and other changes planned in the same window. The simulation can be saved on a change or a business impact analysis as evidence.
- **Build notes:** The impact engine runs on a virtual state map without writing; results stored in `ci_impact_sim` (inputs, outputs json, created_by, linked record); also available as an AI tool.

#### CMDB-014 — Saved maps (business views)
- **Persian name:** نقشه‌های ذخیره‌شده (نمای کسب‌وکار)
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (Business Views), BMC (service models), ServiceNow (maps)
- **What and how:** Users save a map (root CIs, filters, layout, annotations) as a named business view per service or domain, share it with groups and use it as a status board or as the scope of a baseline.
- **Build notes:** `cmdb_map` (name, roots, filter, layout json, audience); rendering always recomputes from live data; an optional snapshot stores the node set for baselines.

#### CMDB-015 — Dynamic CI groups
- **Persian name:** گروه‌های پویای CI
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (CSDM 5 Dynamic CI Groups), ITIL 4 (dynamic service membership by tags/queries), JSM (AQL), iTop
- **What and how:** Groups defined by a query over class, attributes, tags and relationships whose membership updates automatically. They are used for calculated application services, redundancy groups, change scope, notification audiences, data policies, baselines and reports.
- **Build notes:** `ci_group` (kind static|dynamic|redundancy, query AST, min_up); membership materialized in `ci_group_member` by a job on CI change events plus a nightly full refresh.

#### CMDB-016 — CI reference fields on tasks, forms and portal
- **Persian name:** فیلد CI در تیکت‌ها، فرم‌ها و پرتال
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (Assets object field: AQL scope, placeholders, portal default), ManageEngine SDP (CIs Involved, lookup entities), ServiceNow (configuration item field), Freshservice (associated assets), ITIL 4 (affected CI)
- **What and how:** Affected CI (single) and CIs involved (multiple, up to 200) on incidents, problems, changes, releases, requests, projects and contracts. Pickers use dynamic filters with placeholders (the requester's devices; cascading manufacturer → model), show chosen CI attributes on the task, and on the portal pre-select "my laptop". Any custom field can be a CI or asset reference.
- **Build notes:** Engine `ref`/`refs` fields to `ci` with a `refFilter` condition supporting `$requester` and `$field.x` placeholders, resolved at render time and re-checked on submit; requester visibility comes from ITAM assignment keys; displayed CI attributes are declared per form.

#### CMDB-017 — CI 360 page and related records
- **Persian name:** صفحهٔ ۳۶۰ درجهٔ CI و رکوردهای مرتبط
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (Asset 360), ServiceNow (CI form related lists), JSM (connected tickets), ManageEngine SDP, ITIL 4 (consumers of CMDB data)
- **What and how:** The CI page gathers details, relationships (mini map), related incidents, problems, known errors, changes, releases and requests, knowledge articles, contracts and warranties, the linked asset, installed software and components, vulnerabilities, outages and downtime, certifications, health score and history. Requester profiles show the user's CIs.
- **Build notes:** Generic record page with related lists declared in `TableDef.form.related`; counts via the aggregate API; heavy tabs load lazily; each related list is filtered by the viewer's scope.

#### CMDB-018 — CI history, audit trail and notes
- **Persian name:** تاریخچه، رد ممیزی و یادداشت‌های CI
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (activity stream with actor), ServiceNow, JSM (object history, comments), ManageEngine SDP (CI history filters), ISO/IEC 20000-1 (traceable and auditable CI changes)
- **What and how:** Every attribute and relationship change is recorded with old and new value, actor type (user, discovery source, connector, flow, API, AI) and the authorizing change if there is one; history can be filtered by attribute, actor and period. Comments and work notes can be added to CIs. History is immutable and exportable as audit evidence.
- **Build notes:** Engine `sm_history` with `actor_kind` and `source_id`; relationship changes logged on both CIs; `change_id` captured when the write comes through a change task or carries a change reference.

#### CMDB-019 — Query tasks by CI attributes and relationships
- **Persian name:** جست‌وجوی تیکت‌ها بر اساس ویژگی و روابط CI
- **Tier:** P1 · **AI:** no
- **Sources:** JSM (aqlFunction in JQL for queues, SLA goals, automation), ServiceNow (dot-walking), ManageEngine SDP
- **What and how:** Queues, SLA conditions, reports, notification and automation rules can filter tasks by attributes of their CI (dot-walk into the CI) or by the result of a CI query, e.g. "incidents whose CI is a virtual host in the Tehran data centre" or "changes to CIs of Tier 1 services". Results are capped, with a clear message when the cap is exceeded.
- **Build notes:** Add an `in_query` operator to the condition language (sub-select over `ci` with its own condition, capped at 10,000 ids) and jsonb attribute paths (`ci_id.attrs.os`); SQL/JS parity tests as for every operator.

#### CMDB-020 — CMDB query language and visual query builder
- **Persian name:** زبان پرس‌وجوی CMDB و سازندهٔ دیداری پرس‌وجو
- **Tier:** P1 · **AI:** no
- **Sources:** JSM (AQL), ServiceNow (CMDB Query Builder), iTop (OQL), BMC
- **What and how:** A text query language (attribute operators, dot paths through references, inbound/outbound relationship functions with type filters, connected tasks, Jalali-aware date functions, current user and group functions) and a graphical builder that chains classes through relationships. Saved queries feed reports, scheduled exports, dynamic groups and dashboards; both forms compile to the same safe query tree.
- **Build notes:** Parser → AST `{class, filters[], traverse[{rel_type, direction, class}], fields[]}` → SQL with joins over `ci_rel`; executed through `readWhere` with result caps; `cmdb_saved_query` stores AST and text; the same AST is the target of natural-language search (CMDB-043).

#### CMDB-021 — Bulk operations and reclassification
- **Persian name:** عملیات گروهی و تغییر کلاس CI
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (bulk CI-type change), Freshservice (bulk update/delete, trash and restore), JSM (bulk edit, clone, CSV export)
- **What and how:** Bulk edit, bulk state change, soft delete with restore from trash, clone a CI, and reclassify CIs into another class while keeping common attributes, relationships and history (attributes without a target are archived). CSV/Excel export lets the user pick the encoding (UTF-8 with BOM so Persian opens correctly in Excel).
- **Build notes:** Engine bulkUpdate with per-row results; a reclassification job maps attributes by name and type and writes a history entry; exports respect field groups.

#### CMDB-022 — Import framework (files, URLs, API)
- **Persian name:** چارچوب ورود داده (فایل، نشانی وب، API)
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (CSV/JSON/URL imports, scheduled imports, import history), ServiceNow (import sets, transform maps), ManageEngine SDP (CSV/XLS/XLSX import), Freshservice (CSV create/update), BMC
- **What and how:** Import CSV, Excel and JSON (with an array path) from an uploaded file, an HTTPS URL or a token-protected REST import endpoint. Mapping screens set the target class, attribute mapping, references by key or name, child-class mapping and optional creation of missing attributes. A dry run shows a preview; structure changes in the source raise warnings; import history keeps per-row errors; scheduled imports use Jalali-friendly schedules and stop when their owner loses permission. Every import writes through the reconciliation engine.
- **Build notes:** `cmdb_data_source` (kind file|url|api|connector|discovery, mapping json, schedule, owner, priority) with staging tables `import_set`/`import_row`; runs as chunked, resumable jobs within the worker budget. Built on the platform import framework (PLT-065, AI column mapping PLT-066); the CMDB adds class and child-class mapping and the IRE write path.

#### CMDB-023 — Identification and reconciliation engine (IRE)
- **Persian name:** موتور شناسایی و تطبیق (IRE)
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (IRE, reconciliation and data refresh rules, Dynamic IRE), BMC (Reconciliation Engine identify/merge, precedence), JSM (Data Manager keys), Freshservice (identifier order), ManageEngine SDP (identifier rules), iTop (reconciliation keys), standards (ordered candidate keys)
- **What and how:** The only write path for discovery, connectors, imports and APIs. Per class: identification rules (independent, or dependent on a parent such as "application on host") with ordered identifier entries (serial + manufacturer → BIOS UUID → cloud resource id → FQDN → MAC) and lookup tables (serial numbers, network adapters). Zero matches → insert, one → update, several → de-duplication task and no write. Reconciliation rules decide per class and attribute which source wins (priority, tie strategy); refresh rules stop stale sources from overwriting fresher data; partial payloads are accepted; common hardware is identified without hand-built rules.
- **Build notes:** `ci_identification_rule`, `ci_reconciliation_rule`, `ci_refresh_rule`; API `ire.identify(payload)` and `ire.createOrUpdate({items, relations})`; each item processed in one transaction under an advisory lock on its identity key; results logged per source run.

#### CMDB-024 — Attribute provenance and multisource view
- **Persian name:** منشأ هر ویژگی و نمای چندمنبعی
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (CMDB 360 / Multisource CMDB), ManageEngine SDP (Integration Mapping), Ivanti (device sync status), standards (source and last-seen per attribute)
- **What and how:** For every attribute the system keeps which source set the current value and when, plus the latest value reported by each source. The CI page answers "who set this value?", compares sources side by side, shows the source instance id per connector and the sync status of each source.
- **Build notes:** `ci_attr_source` (ci_id, attr, source_id, value, observed_at) upserted by the reconciliation engine; provenance of current values in `ci.attr_meta` jsonb; pruned to the last N observations per source.

#### CMDB-025 — Attribute locks and source policies
- **Persian name:** قفل ویژگی‌ها و سیاست هر منبع داده
- **Tier:** P1 · **AI:** no
- **Sources:** GLPI (locked fields), iTop (per-attribute update and deletion policies), ServiceNow (refresh rules), JSM (stale instead of delete)
- **What and how:** An attribute can be locked on a CI (a manual override that discovery must not overwrite) or set per source to write, read-only or locked. Each source has a deletion policy for things it stops reporting: mark stale after N days, retire, or delete. Nothing disappears silently.
- **Build notes:** `ci.locked_attrs` text[]; `cmdb_data_source.delete_policy` and `stale_after_days`; the reconciliation engine skips locked attributes and records the skipped value in `ci_attr_source`; a staleness job sets `is_stale`.

#### CMDB-026 — Source datasets and golden-record pipeline
- **Persian name:** دادهٔ مرحله‌ای هر منبع و ساخت رکورد طلایی
- **Tier:** P1 · **AI:** no
- **Sources:** JSM (Data Manager: raw → transformed → cleansed → reconciled → schema objects), BMC (provider datasets; Reconciliation Engine jobs identify, merge, compare, copy, purge; qualification sets), iTop (synchro replica tables)
- **What and how:** Each source lands in its own staging dataset and passes persisted, re-runnable stages: raw → transformed (transform functions) → cleansed (rules that drop stale, empty or unwanted records) → reconciled (primary/secondary keys, attribute priorities) → committed. Reconciliation jobs (identify, merge, compare report, copy, purge) can be chained, limited by qualification sets and started manually, on schedule, continuously, by API or from a flow; every step is logged.
- **Build notes:** `import_set` partitions per source and stage; transform and cleansing rules are condition + expression records; job chains run in the flow engine; the compare report diffs a source dataset against the CMDB by reconciliation id.

#### CMDB-027 — Cross-source coverage and data-dictionary issues
- **Persian name:** پوشش بین منابع و ایرادهای واژه‌نامهٔ داده
- **Tier:** P1 · **AI:** no
- **Sources:** JSM (Data Manager: important attributes, verified flags, Venn coverage, data dictionary issues), ServiceNow (discovery coverage), standards (managed vs unmanaged devices)
- **What and how:** Compares "important" attributes across sources (matching values are marked verified, conflicts are flagged) and shows coverage between sources as Venn diagrams: in AD but without an antivirus/EDR agent, discovered but not in ITAM, in ITAM but never discovered. Data-dictionary rules compute issues such as an unsupported OS, missing disk encryption or an unknown model; each issue can open a task for its owner.
- **Build notes:** Nightly job over `ci_attr_source` and source membership writes `cmdb_finding` rows (kind coverage|dictionary) with idempotent keys; dashboard widgets read aggregates.

#### CMDB-028 — De-duplication tasks and merge
- **Persian name:** وظایف رفع تکرار و ادغام CI
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (de-duplication tasks, remediation templates), BMC (reconciliation merge), Freshservice (staging of duplicate candidates), ManageEngine SDP
- **What and how:** When the reconciliation engine finds several matches, or a health job finds probable duplicates, a de-duplication task lists the candidates. The analyst (or a remediation template) picks the main CI, previews the merged result and merges: relationships, task references, history, attachments and asset links move to the survivor. Side-effect rules can be suppressed during the merge, and every merge can be undone from a journal.
- **Build notes:** `cmdb_dedup_task` (number DUP; candidate refs, main_ci_id, template_id; states new → in_progress → resolved → closed, canceled for false positives); the merge runs in one transaction and writes `ci_merge_journal` for undo.

#### CMDB-029 — AI duplicate CI remediator
- **Persian name:** دستیار هوشمند رفع تکرار CI
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (Duplicate CI Remediator, Manage duplicate CIs, de-duplication task resolution assistant), standards (fuzzy reconciliation), ITIL v5 (detecting duplicate CMDB records)
- **What and how:** Finds duplicates the identification rules missed and explains them. Record linkage uses blocking keys (serial, normalized MAC, cloud id, BIOS UUID, hostname + domain), pair features (name similarity, IP overlap, same model and location, discovery gap) and a score learned from past admin decisions. It preselects the survivor by source precedence and recency, shows its reasoning and the likely root cause (a weak identification rule, a second discovery source) and recommends a template; the admin reviews, edits and applies. Feedback is logged.
- **Build notes:** Scoring in code (Fellegi–Sunter or logistic regression trained on `cmdb_dedup_task` outcomes); the LLM only writes the explanation from computed features; nightly job plus on-demand skill; never auto-merges unless the tenant enables it above a score threshold.

#### CMDB-030 — CMDB health scorecards
- **Persian name:** کارنامهٔ سلامت دادهٔ CMDB
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (CMDB Health: completeness, correctness, compliance), ManageEngine SDP (data quality policies, per-CI scorecard), BMC (data quality dashboards), COBIT BAI10.05, FitSM PR11, analytics (health score)
- **What and how:** Three measures per class and owner group: completeness (required and recommended attributes filled), correctness (duplicates, orphans by relationship rules, staleness by a per-class "not updated in N days" threshold) and compliance (audit and certification results), combined into a weighted health score with trends, drill-down to failing CIs and a scorecard on each CI. Remediation tasks go to CI owners or support groups without duplicates.
- **Build notes:** Nightly jobs per class write `cmdb_health_fact(date, class, owner_group, metric, numerator, denominator)`; per-CI flags in `ci.health` jsonb; remediation via `cmdb_finding` with dedupe keys.

#### CMDB-031 — Data-quality rules (data monitor)
- **Persian name:** قواعد کیفیت داده (پایشگر داده)
- **Tier:** P1 · **AI:** no
- **Sources:** BMC (Data Monitor: missing/invalid attributes, missing/inconsistent relationships), ManageEngine SDP (completeness, staleness and orphan policies), iTop (audit rules)
- **What and how:** Tenant-defined rules detect missing or invalid attribute values and missing or inconsistent relationships: a server without an owner, an application without a host, a CI in two locations, an IP outside its subnet. Rules run on write (as a warning) and on schedule (as a finding with owner and due date) and their violations are listed in the CMDB workspace.
- **Build notes:** `cmdb_rule` (kind data_quality, class, condition or query AST, severity, owner_field) evaluated by the shared condition engine; findings in `cmdb_finding` (number FND; new → in_progress → resolved → closed, waived = canceled).

#### CMDB-032 — Audit rules and compliance templates
- **Persian name:** قواعد ممیزی و الگوهای انطباق
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (compliance against certification templates), iTop (audit categories with OQL rules and compliance %), ISO/IEC 20000-1 §8.2.6, COBIT BAI10.05
- **What and how:** Audit categories group rules that list non-compliant CIs (expected attribute values and relationships per class, e.g. "every production database has a backup relationship"), compute a compliance percentage per category and class, keep each audit run as evidence and create corrective tasks.
- **Build notes:** `cmdb_rule` (kind audit) grouped by `audit_category`; each run stored in `cmdb_audit_run` (counts, snapshot of failing ids); compliance feeds the health score.

#### CMDB-033 — Planned verification with sampling
- **Persian name:** راستی‌آزمایی برنامه‌ریزی‌شده با نمونه‌گیری
- **Tier:** P1 · **AI:** no
- **Sources:** ISO/IEC 20000-1 §8.2.6, FitSM PR11.5, COBIT BAI10.05, ITIL SCM (verifying configuration data), standards (stratified sampling with confidence interval)
- **What and how:** Verification plans per class at planned intervals draw a stratified sample, compare CMDB records with discovery and physical evidence (linked to ITAM physical audits), record matches and mismatches, publish accuracy with a confidence interval, open corrective actions and produce a verification report kept as evidence.
- **Build notes:** `cmdb_verification` (plan, class, sample size, sample ids, results json, accuracy, ci_low, ci_high); tasks for mismatches; report rendered to PDF.

#### CMDB-034 — Data certification and attestation campaigns
- **Persian name:** کارزارهای تأیید داده توسط مالکان
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Data Certification, Data Manager attestation), ITIL 4 (attestation campaigns), EU DORA (yearly review of ICT asset mapping)
- **What and how:** Campaigns send certification tasks to CI owners to confirm or correct chosen attributes and relationships of their CIs by a due date, with reminders, escalation when owners do not respond, attachments, reset and review of tasks and live percent complete. Results feed the compliance score and serve as yearly review evidence.
- **Build notes:** `ci_cert_campaign` (number CRC; scope query, attributes, due date) and `ci_cert_task` (number CRT; owner, CI list; new → in_progress → resolved → closed, canceled); bulk-confirm UI; reminders via notification rules.

#### CMDB-035 — CI data management policies
- **Persian name:** سیاست‌های مدیریت دادهٔ CI
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (CMDB Data Manager: retire, archive, delete, attestation and certification policies), BMC (Data Automation console)
- **What and how:** Policies apply lifecycle operations to CIs matching conditions on a schedule: retire stale CIs, archive retired ones after N months, delete archived ones after the retention period, start attestation or certification. A policy can require approval and assign tasks to owners; each execution is logged with the CIs affected and those skipped (for example for lack of permission).
- **Build notes:** `cmdb_policy` (kind, condition, schedule, approval, action) and `cmdb_policy_run` log; archiving moves rows to `ci_archive` and closes their relationships with `valid_to`.

#### CMDB-036 — CMDB scope and level-of-detail policy
- **Persian name:** سیاست دامنه و سطح جزئیات CMDB
- **Tier:** P1 · **AI:** no
- **Sources:** FitSM-1 PR11.1–11.3, ISO/IEC 20000-1 §8.2.6, ITIL SCM (common approach; avoid over-engineering), COBIT BAI10
- **What and how:** States which classes and relationship types are in scope, the required and recommended attributes per class (more detail for critical services), which classes must have an owner, staleness thresholds and the review cadence. The policy drives health scoring, certification scope and mandatory fields, and is itself reviewed periodically.
- **Build notes:** `cmdb_scope_policy` (versioned) compiled into `ci_class.health_cfg` and UI policies; a policy change triggers health recalculation.

#### CMDB-037 — Configuration baselines and comparison
- **Persian name:** خط‌مبناهای پیکربندی و مقایسه
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (CMDB baselines and compare), COBIT BAI10 (approved baselines), ITIL (baseline configuration), ServiceNow (baselines/Unified Map), Freshservice (drift baseline)
- **What and how:** Snapshot the attributes and relationships of a scope (class, saved map or dynamic group) as a named baseline (release baseline, golden image, security baseline), approve it, compare two baselines or a baseline with the current state (added, removed, modified) and keep per-CI version history for audits and post-implementation reviews.
- **Build notes:** `ci_baseline` (scope, approved_by, approved_at) and `ci_baseline_item` (ci_id, attrs json, rels json); diffs computed by reconciliation id in a job for large scopes.

#### CMDB-038 — Configuration control and drift detection
- **Persian name:** کنترل پیکربندی و کشف انحراف
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (configuration control through change), Freshservice (configuration drift detection), ManageEngine SDP (baselines), NetBox Labs (assurance of intended vs operational state), COBIT BAI10, ISO/IEC 20000-1
- **What and how:** Controlled classes or attributes may change only through an authorized change: direct edits are blocked or flagged, and discovered changes are matched with approved changes and baselines. A difference outside an approved change window creates a drift record (expected vs actual, source), an unauthorized-change alert and, by rule, an incident or a change; the drift is then accepted (baseline updated) or remediated. A report lists CIs changed without an approved change.
- **Build notes:** `ci_class.controlled_attrs`; the reconciliation engine asks the change module for open changes on the CI and their windows; `ci_drift` (number DRF; new → investigating → resolved (accepted|remediated) → closed); notifications and flow triggers.

#### CMDB-039 — AI data-quality governor
- **Persian name:** ناظر هوشمند کیفیت دادهٔ CMDB
- **Tier:** P1 · **AI:** yes
- **Sources:** BMC (CMDB Governor agent, Data Monitor insights), ServiceNow (governance summary, Summarize CMDB readiness, CMDB Success Advisor), ServiceNow CSDM adoption stages
- **What and how:** An agent reads health results, rule violations, de-duplication outcomes and source statistics, finds root causes (a source with bad identifiers, a missing reconciliation rule, owners who never certify), recommends concrete fixes and writes a short governance summary plus a readiness/maturity assessment with a remediation plan. It regenerates when filters change and can open proposed tasks.
- **Build notes:** Deterministic analysis queries produce a facts JSON; the LLM narrates and ranks recommendations with links; actions are proposals (tasks, draft rules) confirmed by the configuration manager.

#### CMDB-040 — AI data completion and enrichment
- **Persian name:** تکمیل و غنی‌سازی هوشمند داده‌ها
- **Tier:** P1 · **AI:** yes
- **Sources:** InvGate (Atlas AI Agent, Data Completeness), standards (CI class and owner suggestions), ServiceNow (asset insights)
- **What and how:** Suggests missing values for CIs and assets — class, owner, support group, location, cost centre, model, end-of-support and end-of-life dates — from signals such as logged-in users, IP subnet to site, naming conventions, similar CIs and discovery data. Each suggestion shows its reasoning and confidence; accepting or rejecting it is logged on the record, and a data-completeness view tracks improvement over time.
- **Build notes:** Candidate values come from rules and nearest-neighbour search over similar CIs; the LLM is used for free-text evidence and explanations; proposals stored in `ai_proposal` (field, value, confidence, evidence); auto-apply only above a tenant threshold.

#### CMDB-041 — AI relationship suggestions
- **Persian name:** پیشنهاد هوشمند روابط
- **Tier:** P1 · **AI:** yes
- **Sources:** ai research (open market gap), ITIL 4 (relationship inference from traffic/logs), standards (inference from flows and traces), ServiceNow (traffic-based connection suggestions)
- **What and how:** Proposes missing relationships from three kinds of evidence: observed connections (listening and established sockets, load-balancer pools, DNS aliases) → Connects to / Runs on; co-occurrence of CIs in incidents, alerts and changes within short windows (association rules with lift > 3 and support ≥ 5) → Depends on; and connection strings parsed from configuration files. Suggestions go to the CI owner with the evidence attached; accepted edges are saved with origin ai_suggested and rejected pairs are not suggested again.
- **Build notes:** Suggestion jobs write `ci_rel_suggestion` (parent, child, type, evidence json, score; proposed → accepted|rejected); the LLM is used only for config parsing and evidence summaries.

#### CMDB-042 — Attribute anomaly detection
- **Persian name:** کشف ناهنجاری در ویژگی‌های CI
- **Tier:** P2 · **AI:** yes
- **Sources:** ITIL 4 (attribute anomaly detection), standards (configuration-drift anomaly detection)
- **What and how:** Flags unusual changes that rules do not cover: memory or disk count going down, a serial number changing on the same CI, a CI jumping between sites, values flapping between two sources. Anomalies feed drift review and de-duplication.
- **Build notes:** Per-attribute change statistics (frequency, typical deltas) with robust z-scores; anomalies stored as `cmdb_finding` (kind anomaly) with an LLM-written explanation.

#### CMDB-043 — Natural-language CMDB search
- **Persian name:** جست‌وجو در CMDB با زبان طبیعی
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (Search CMDB agentic workflow), JSM (Rovo over Assets/AQL, /search-hardware), standards (NL querying filtered by permissions), analytics (ACL-true AI analyst)
- **What and how:** Users ask in Persian or English — "چه خدماتی به سرور X وابسته‌اند؟" or "laptops in use in Tehran whose warranty ends this month". The question becomes a keyword search, a single-class query with dot-walks or a multi-class relationship query, runs with the user's permissions, and the generated query is shown so users learn it and can save it.
- **Build notes:** Schema cards for the top-k classes (chosen by embedding similarity) → the LLM returns the query AST of CMDB-020, which is validated against the schema and run through `readWhere`; queries scanning the whole graph without filters are rejected; Persian normalization (ی/ي، ک/ك، نیم‌فاصله، digits) is applied before matching.

#### CMDB-044 — AI CI summary
- **Persian name:** خلاصهٔ هوشمند CI
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (CI summarization), JSM (Rovo), BMC (Service Collaborator)
- **What and how:** From the CI page, a list or a workspace: a short summary of discovery data, ownership, open incidents, alerts and problems, upcoming changes and maintenance, vulnerabilities, service membership and data health, each item linked. Used in incident, change and event work.
- **Build notes:** Facts assembled in code (counts, lists, next change window, last discovery); the LLM writes prose only from those facts; cached per CI and invalidated by events on related tasks.

#### CMDB-045 — Conversational CI creation
- **Persian name:** ایجاد گفت‌وگومحور CI
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Create configuration item agentic workflow)
- **What and how:** For physical or OT items that discovery cannot see: the assistant confirms the class, asks for the identifying attributes required by the class's identification rule and the mandatory fields, checks for duplicates first, and then either updates the existing CI or creates a new one.
- **Build notes:** Slot schema generated from `ci_identification_rule` plus class-required fields; the reconciliation engine's identify step runs before create; the write is a proposal confirmed by the user.

#### CMDB-046 — Graph tools for AI agents
- **Persian name:** ابزارهای گراف برای عامل‌های هوشمند
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (AIOps AI Specialist uses CMDB and topology), BMC (AIOps situations), Dynatrace (topology-based causal AI), ai research (topology for AI grounding)
- **What and how:** Agents in incident, change and event work get typed tools — impact_of(ci), blast_radius(change), path_between(a, b), ci_summary(ci), recent_changes(ci, window), dependents(service) — whose results are permission-trimmed and cited, so root-cause and risk agents reason over the real graph instead of guessing.
- **Build notes:** Tools generated from the impact engine and record service, run with the user's context or the agent's run-as role; hidden nodes are redacted as in CMDB-076.

#### CMDB-047 — Connector and import diagnosis
- **Persian name:** عیب‌یابی هوشمند اتصال‌ها و ورود داده
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Service Graph Connector diagnosis, Now Assist for ITOM agents, SaaS troubleshooting guidance)
- **What and how:** Summarizes failed import rows, connector and discovery errors, explains the likely cause (expired credential, firewall, mapping mismatch, API quota) and recommends a fix with a link to the relevant setting.
- **Build notes:** Errors grouped by code and source; the LLM explains from grouped samples with secrets redacted; output is advice only.

#### CMDB-048 — On-premises discovery collector
- **Persian name:** جمع‌آورندهٔ درون‌سازمانی کشف خودکار
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (MID Server), JSM (Assets Discovery Collector), Freshservice (Discovery Probe, Device42 Remote Collector), InvGate (proxy), GLPI (agent)
- **What and how:** A collector service inside the customer network pulls discovery jobs from the server over outbound-only HTTPS, runs scans and probes and posts normalized results to the reconciliation API. Collectors can be clustered, have capabilities and assigned IP ranges, report heartbeat and version and update themselves. The Windows desktop app can host a collector.
- **Build notes:** `discovery_collector` (name, capabilities, ranges, last_heartbeat, version, key fingerprint); signed job leases from `sm_jobs` lane external; results via the token-authenticated IRE endpoint; no inbound ports.

#### CMDB-049 — Agentless network discovery
- **Persian name:** کشف خودکار بدون عامل در شبکه
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (horizontal discovery: scan, classify, identify, explore), JSM (Assets Discovery: WMI, WinRM, SSH, SNMP), Freshservice (Discovery Probe), ManageEngine SDP (network, domain, SNMP v3, VMware scans), GLPI (network discovery and inventory)
- **What and how:** Scans IP ranges (ping and port probe), classifies devices, identifies them and explores details over WMI/WinRM, SSH, SNMP v1/v2c/v3 (SHA-2, AES), the VMware vSphere and Hyper-V APIs and database probes. Builds layer-2/3 topology from LLDP/CDP/ARP and covers servers, workstations, printers, switches, routers, access points, firewalls, load balancers and storage; also Windows domain and AD computer scans and quick discovery of a single IP.
- **Build notes:** Probe modules in the collector emit the shared normalized JSON schema; classification rules are data; results enter through the reconciliation engine with source = discovery:<collector>.

#### CMDB-050 — Discovery credentials vault
- **Persian name:** گاوصندوق اعتبارنامه‌های کشف
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (credentials, external vaults, credential affinity), JSM (credential test buttons), ManageEngine SDP (credential library with validation), access research (secrets readable by nobody)
- **What and how:** Stores SSH keys and passwords, WMI/WinRM, SNMPv3, VMware, cloud and database credentials encrypted. No one can read them through the UI or API; a test button checks a credential against a host; credential affinity remembers which credential worked for each host; external vaults (HashiCorp Vault, CyberArk) are optional; credentials are scoped to collectors.
- **Build notes:** `discovery_credential` with secret fields (AES-256-GCM, tenant key) decrypted only by the collector job identity; `credential_affinity(ip, credential_id)`; every use logged.

#### CMDB-051 — Endpoint inventory agent
- **Persian name:** عامل موجودی‌گیری روی دستگاه‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Agent Client Collector), Freshservice (Discovery Agent), ManageEngine SDP (unified agent), GLPI (GLPI Agent), InvGate (agents without admin rights), JSM (Discovery Agent), Atera and Ivanti (RMM inventory)
- **What and how:** A lightweight agent for Windows, Linux and macOS (Android optional) reports hardware, components, installed software with versions and install dates, logged-in users, software usage and security posture (antivirus/EDR, disk encryption, patch level), and keeps reporting off-network through the cloud endpoint. Deployable via GPO, Intune or SCCM; supports custom checks and remote collection of registry keys, WMI classes and files.
- **Build notes:** The agent posts signed payloads to the reconciliation endpoint; `endpoint_agent` (ci_id, version, last_seen, policy); the payload schema is shared with the collector; agent policy is distributed as config records.

#### CMDB-052 — Cloud discovery
- **Persian name:** کشف خودکار منابع ابری
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (cloud discovery, event-driven updates), Freshservice (AWS, Azure, GCP discovery), JSM (cloud adapters), ITIL 4 (infrastructure and platform management)
- **What and how:** Read-only API connections to cloud accounts (AWS, Azure, GCP, Oracle and Iranian clouds such as ArvanCloud) discover accounts, regions, VMs, networks, storage, databases, serverless functions and managed services with their tags. Updates arrive on schedule or from cloud events; deleted resources are retired, not erased.
- **Build notes:** One connector per provider in the connector framework (CMDB-056); credentials in the vault; tags stored in `ci.tags` and reused by tag-based service mapping and cost allocation.

#### CMDB-053 — Kubernetes and container discovery
- **Persian name:** کشف خودکار Kubernetes و کانتینرها
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (Kubernetes discovery), Freshservice (Device42 container discovery), iTop 3.3 (container classes)
- **What and how:** Discovers clusters, namespaces, workloads, services and ingresses, maps container images to software, and summarizes short-lived objects at workload level instead of storing every pod.
- **Build notes:** Kubernetes API connector; ephemeral objects aggregated; label-based service mapping reuses CMDB-057.

#### CMDB-054 — Discovery patterns and extensibility
- **Persian name:** الگوهای کشف و توسعه‌پذیری
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (Pattern Designer with step-by-step debugging), JSM (pattern-based collection), ManageEngine SDP (custom SNMP product types)
- **What and how:** Declarative probe patterns (commands or API calls, parsing steps, mapping to classes and attributes) with step-by-step debugging against a test host, a pattern library and custom device types (for example new SNMP OIDs) without code changes.
- **Build notes:** `discovery_pattern` records (steps json, version) interpreted by the collector in a sandbox; patterns are signed by the server.

#### CMDB-055 — Discovery schedules, runs and error insights
- **Persian name:** زمان‌بندی، اجرا و تحلیل خطاهای کشف
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Discovery Admin Workspace, error insights), ManageEngine SDP (scheduled re-scans, overdue scan settings, scan summary export), JSM (scheduled scans)
- **What and how:** Schedules by IP range, behaviour, credentials and collector (Jalali-aware recurrence), run history with per-device status, error classes (authentication failed, port closed, timeout, unsupported device) with remediation guidance, overdue-scan alerts, range coverage and exportable scan summaries.
- **Build notes:** `discovery_schedule`, `discovery_run` (number DSC) and `discovery_device_status`; errors grouped by code for CMDB-047.

#### CMDB-056 — Connector library
- **Persian name:** کتابخانهٔ اتصال‌دهنده‌ها به منابع داده
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Service Graph Connectors), JSM (Data Manager sources, marketplace adapters, Entra ID app), Freshservice (Intune, Jamf, Workspace ONE, Lansweeper), ManageEngine SDP (OpManager, Endpoint Central), Ivanti and Atera (RMM inventory)
- **What and how:** Reconciliation-aware connectors with guided setup and editable mappings: Active Directory and Entra ID (users, groups, computers), Intune, SCCM/MECM, Jamf, Workspace ONE, Lansweeper, Tanium, vCenter, Hyper-V/SCVMM, Proxmox, monitoring tools (Zabbix, PRTG, SolarWinds, OpManager), security tools (Kaspersky Security Center, ESET PROTECT, Padvish, Defender, CrowdStrike, Qualys, Tenable, Rapid7), ITAM tools (Snow, Flexera, Device42) and cloud providers, plus an SDK for custom connectors.
- **Build notes:** A connector is a config record + transform map + scheduled job in lane external; each run produces an import set processed by the reconciliation engine; health and last run shown per connector.

#### CMDB-057 — Tag-based and calculated application services
- **Persian name:** خدمات کاربردی برچسب‌محور و محاسبه‌شده
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (tag-based service mapping, dynamic CI group / calculated services), ITIL 4 (dynamic service membership), BMC (AIOps service blueprints)
- **What and how:** Application services defined by tags or labels (cloud, Kubernetes, VMware) or by dynamic CI groups; membership updates automatically and the layered service map feeds event impact, change impact and SLAs without manual mapping.
- **Build notes:** `service_instance.membership_query` → `ci_group`; a job keeps Member of edges with origin rule; closure refreshed on change.

#### CMDB-058 — Top-down and traffic-based service mapping
- **Persian name:** نگاشت خدمت از بالا به پایین و مبتنی بر ترافیک
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Service Mapping top-down, traffic-based ML suggestions, AI agent topology mapping), Freshservice (Device42 application dependency mapping), BMC (service models from discovered data)
- **What and how:** Starting from an entry point (URL, host and port, queue), follows real connections and processes with patterns to build an application service map layer by layer; learning over traffic data suggests further connections; AI agents are mapped with the models, tools and MCP servers they use.
- **Build notes:** Collector patterns gather process and connection data; suggestions are written to `ci_rel_suggestion` for review; mapped services stored as service instances with origin discovery.

#### CMDB-059 — Infrastructure-as-code state import
- **Persian name:** ورود وضعیت زیرساخت به‌صورت کد
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (IaC-driven change records; infrastructure and platform management), IT4IT (desired topology), NetBox Labs (intended vs operational state)
- **What and how:** Reads Terraform state, Ansible inventories and Helm releases as a "desired topology" source, links resources to CIs and compares intended with discovered state to raise drift (CMDB-038).
- **Build notes:** Connector type iac producing a desired-state dataset; the comparison reuses the baseline diff.

#### CMDB-060 — Certificate inventory and expiry management
- **Persian name:** موجودی گواهی‌های دیجیتال و مدیریت انقضا
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Certificate Inventory and Management, Machine Identity Console), InvGate (digital assets: certificates), continuity research (certificate expiry prevention)
- **What and how:** Discovers TLS/SSL certificates on endpoints, load balancers and cloud or imports them from certificate authorities; stores subject, SANs, issuer, serial, validity, key algorithm and size and the hosts that use each certificate; warns at 30/14/7 days, opens renewal tasks or changes and shows expiring certificates on the affected services. Machine identities (service accounts, API keys) can be inventoried the same way.
- **Build notes:** CI class certificate with Uses certificate relationships; daily job on `not_after`; notification and flow templates; private keys and secrets are never stored.

#### CMDB-061 — AI systems and digital asset classes
- **Persian name:** کلاس‌های سامانه‌های هوش مصنوعی و دارایی‌های دیجیتال
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (CSDM 5 AI system and AI model classes, AI Control Tower discovery), InvGate (AI assets: agents, models, MCP servers, skills, plugins; digital assets), ITIL v5 (AI system inventory including shadow AI)
- **What and how:** CI classes for AI systems, models, agents, MCP servers, skills and plugins, prompt templates and third-party AI services, plus digital assets such as automation workflows and bots. Each has owner, lifecycle, provider and model version, data classification, autonomy level and links to devices, people, business applications and services, so change, incident and impact analysis cover AI components and the AI governance module has a real inventory.
- **Build notes:** Classes in the class pack; the tenant's own AI agents and model connections are registered automatically as CIs; shadow-AI candidates come from SaaS discovery (ITAM-069).

#### CMDB-062 — Information and data asset inventory
- **Persian name:** موجودی دارایی‌های اطلاعاتی و داده
- **Tier:** P1 · **AI:** no
- **Sources:** ISO/IEC 27001 A.5.9 and A.5.12–5.13, NIST CSF ID.AM-07, EU DORA (information assets)
- **What and how:** Information assets (databases, datasets, document repositories, file shares) with owner, classification and labelling, personal-data flags, storage location and residency, retention period and links to the applications and services that use them; used by security, privacy and continuity.
- **Build notes:** CI class information_asset; its classification drives record confidentiality and redaction before AI indexing; links through `ci_rel`.

#### CMDB-063 — Data flows and authorized communications
- **Persian name:** جریان‌های داده و ارتباطات مجاز
- **Tier:** P2 · **AI:** no
- **Sources:** iTop 3.3 (Flow class), NIST CSF ID.AM-03, standards
- **What and how:** Flow records between functional CIs (protocol, port, direction, data classes, encryption, authorized or not, justification) with their own impact-propagation flag; reports list unauthorized or unencrypted flows as evidence for firewall reviews.
- **Build notes:** CI class data_flow with its endpoints as relationships; the propagation flag is honoured by the impact engine.

#### CMDB-064 — Software composition (SBOM)
- **Persian name:** ترکیب نرم‌افزار (SBOM)
- **Tier:** P2 · **AI:** no
- **Sources:** SPDX 3.0 / ISO/IEC 5962, CycloneDX / ECMA-424, NIST CSF ID.AM-02, EU Cyber Resilience Act, ServiceNow (CSDM 5 SBOM tracking)
- **What and how:** Attach or import an SBOM per software CI or version; components are stored with purl/CPE and licences and feed vulnerability matching (security module), open-source licence obligations and VEX status.
- **Build notes:** `sbom` and `sbom_component` (ci_id, name, version, purl, cpe, license); uses the shared software catalogue keys from ITAM for matching.

#### CMDB-065 — Resilience attributes and critical-function propagation
- **Persian name:** ویژگی‌های تاب‌آوری و انتشار حیاتی‌بودن
- **Tier:** P1 · **AI:** no
- **Sources:** EU DORA Art. 8, ISO 22301 §8.2.2, ISO/IEC 27001 A.8.13–8.14, standards (critical-function propagation), ITIL 4
- **What and how:** Services and CIs carry tier, RTO/RPO/MTPD from the business impact analysis and redundancy and recovery relationships (backs up, fails over to, recovery site). A computed "supports a critical or important function" flag and the maximum criticality propagate down the dependency graph, so change risk, DR planning, supplier criticality and regulatory mapping read them directly.
- **Build notes:** `ci.supports_critical_function` and `ci.max_criticality`, recomputed incrementally by a job when relationships or service tiers change; BIA values are owned by the continuity module.

#### CMDB-066 — Security configuration baselines
- **Persian name:** خط‌مبناهای پیکربندی امن
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC 27001 A.8.9, NIST CSF PR.PS-01, ITIL 4 (secure configuration baselines)
- **What and how:** CIs reference a hardening baseline (for example a CIS benchmark profile or golden image) and receive a compliance status from scanners or agents; non-compliance or drift opens an incident or a change.
- **Build notes:** `security_baseline` records; compliance results imported via connectors into `ci_attr_source`; rules reuse CMDB-031.

#### CMDB-067 — IP address management (IPAM)
- **Persian name:** مدیریت نشانی‌های IP
- **Tier:** P2 · **AI:** no
- **Sources:** NetBox (IPAM: VRFs, prefixes, ranges, IPs, VLANs, ASNs)
- **What and how:** Sites, VRFs, prefixes, ranges, IP addresses assigned to interfaces and CIs, VLANs and ASNs, with utilization per prefix, conflicts (the same IP on two CIs) and differences between discovered and planned addresses.
- **Build notes:** CI classes ip_prefix, ip_address and vlan with containment relationships; utilization computed by a job.

#### CMDB-068 — Data centre and rack modelling
- **Persian name:** مدل‌سازی مرکز داده و رک
- **Tier:** P2 · **AI:** no
- **Sources:** NetBox (racks with elevations, device types, cables with tracing, power, circuits), Freshservice (data-centre asset types)
- **What and how:** Racks with elevation views (U positions), devices from a device-type library, interfaces and cables with path tracing, power feeds (PDU/UPS) and circuits, placed by site, building, floor and room.
- **Build notes:** CI classes rack, cable, circuit and power_feed; `ci.attrs.rack_u`; the elevation view is a special page.

#### CMDB-069 — Federation and provider-owned attributes
- **Persian name:** فدراسیون داده و ویژگی‌های متعلق به تأمین‌کننده
- **Tier:** P2 · **AI:** no
- **Sources:** DMTF CMDBf, SIAM BoK (shared data dictionary, provider-owned attributes), FitSM (federation), ITIL SCM (several CMDBs)
- **What and how:** External repositories (provider CMDBs, cloud inventories) are registered and queried in place or synchronized; for each federated attribute the authoritative party is recorded, and a shared data dictionary defines meaning across providers.
- **Build notes:** `cmdb_data_source.federated = true` with a live query adapter; `ci_reconciliation_rule` holds provider authority per attribute.

#### CMDB-070 — CI maintenance schedules and downtime log
- **Persian name:** برنامهٔ نگهداری و سوابق ازکارافتادگی CI
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (CI downtime, downtime notification rules), ServiceNow (maintenance schedule, outages)
- **What and how:** Each CI can reference a maintenance schedule. Planned and unplanned downtime entries (from changes, incidents and outage records) appear on the CI with a downtime summary, CIs in downtime are highlighted on maps, and notification rules inform owners and subscribers.
- **Build notes:** Uses the shared `outage` records (owned by the SLM/continuity modules) filtered by CI; `ci.maintenance_calendar_id` points to engine calendars.

#### CMDB-071 — Cloud tag governance and provisioning templates
- **Persian name:** حاکمیت برچسب‌های ابری و الگوهای تأمین منابع
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (Tag Governance, Cloud Provisioning and Governance), Freshservice (EC2 orchestration actions)
- **What and how:** Tag policies (required keys, allowed values) with compliance views and remediation tasks for cloud resources; a catalogue of approved cloud templates (Terraform, ARM, CloudFormation, Helm) with quotas, approvals and lifecycle actions (start, stop, resize) that create CIs.
- **Build notes:** Policies as `cmdb_rule` over cloud classes; provisioning via catalog items and flows calling provider APIs; outputs written through the reconciliation engine.

#### CMDB-072 — CMDB workspace
- **Persian name:** میز کار CMDB
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (CMDB Workspace, Service Graph Workspace panels, CMDB Success Advisor, Data Foundations dashboards), BMC (persona-based UI), analytics (CMDB workspace pattern)
- **What and how:** A home for configuration managers and CI owners: health cards and trends, a class navigator, search by context (no need to know the data model), "my CIs" and "my remediation tasks", a governance view with an AI summary, data-foundation dashboards (principal classes, hardware, software installs), the query builder and company, location and user panels.
- **Build notes:** Special page composed of generic widgets and the aggregate API; default layout per persona; every widget is permission-filtered.

#### CMDB-073 — CMDB reports and status accounting
- **Persian name:** گزارش‌های CMDB و حسابداری وضعیت
- **Tier:** P0 · **AI:** no
- **Sources:** COBIT BAI10.04, ISO/IEC 20000-1, JSM (Assets dashboards), ManageEngine SDP (CMDB dashboard), BMC (CMDB value dashboards), EU DORA
- **What and how:** Ready reports: CIs by class, state, owner and location; CIs changed without an approved change; baseline vs actual; critical-function and provider dependency maps; health trends; CI-populated rate on incidents and changes; CMDB value and usage (share of tasks that use CI data). Chart types and drill-down come from the analytics engine.
- **Build notes:** Report definitions shipped as config records over `ci`, `ci_rel`, `cmdb_health_fact` and the task tables.

#### CMDB-074 — CMDB automation triggers and actions
- **Persian name:** رویدادها و اقدام‌های خودکارسازی CMDB
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (Assets automation: object created/updated/deleted, attribute changed, lookup objects, branch on AQL, scheduled AQL flows), ServiceNow (flows on CMDB tables), ManageEngine SDP
- **What and how:** Flows start when a CI is created, updated or deleted, when a specific attribute changes (with old and new values), when a relationship is added or removed, or on health and drift events. Actions create, update or look up CIs, branch over a CMDB query and set CI fields on tasks; scheduled flows run over query results (for example warranty or certificate expiry reminders).
- **Build notes:** Engine events `record.*` for `ci` and `ci_rel` plus a derived `attribute_changed` event; flow steps "look up CIs" (query AST, up to 100 results) and "for each".

#### CMDB-075 — CMDB access model
- **Persian name:** مدل دسترسی CMDB
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (CMDB roles, edit_ci_relations, domain separation, field ACLs), JSM (schema and object-type roles), BMC (company and "used by" tenancy), GLPI (entity recursion), iTop (organization silos), Ivanti (object rights), Freshservice (Configuration Manager role)
- **What and how:** Grants per class and action (read, create, update, delete, edit relationships) with scopes: CI owner (own), support or managed-by group (group), owning unit subtree, location subtree, company/domain and workspace (IT, Facilities). Support-group members can edit their CIs; editing relationships is a separate right; company tenancy includes "used by" companies; objects can be visible in child entities; portal users see only CIs referenced by their own requests or assigned to them. Built-in roles: CMDB viewer, CI owner, configuration analyst, configuration manager, CMDB admin, discovery admin.
- **Build notes:** Scope profile on `ci`: own = [owned_by, managed_by], group = [support_group_id, managed_by_group_id], unit = unit_id, location = location_id, company/domain = company_id/domain_id, plus extra keys for used-by companies; the `edit_relations` action is checked on `ci_rel` writes.

#### CMDB-076 — Permission-aware graph traversal
- **Persian name:** پیمایش گراف با رعایت دسترسی
- **Tier:** P0 · **AI:** no
- **Sources:** access research (per-node filtering, restricted placeholders, impact computed as system and shown as subject)
- **What and how:** Impact and dependency views apply the read rule to every node. Hidden nodes appear only as an anonymous "restricted CI" placeholder when needed to keep a path, never with names or attributes. Impact is computed with system rights so results are correct, but what a user sees, exports or hands to AI is redacted to what they may read.
- **Build notes:** Traversal returns raw ids; a post-filter checks `readWhere` in bulk and replaces unreadable nodes; the same function serves AI graph tools and exports.

#### CMDB-077 — CMDB and IRE APIs
- **Persian name:** رابط‌های برنامه‌نویسی CMDB و موتور تطبیق
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (IdentificationEngine API), JSM (REST and Imports API), ManageEngine SDP (CMDB REST API), Freshservice (Assets API, bulk relationships)
- **What and how:** The generic record API for CI tables plus reconciliation endpoints (identify, createOrUpdate with items and relations), bulk asynchronous jobs with status polling, graph and impact endpoints and OpenAPI documentation. Integration tokens are bound to a source and to the classes they may write.
- **Build notes:** Hono routes on the record service; a token maps to an integration user with a source binding; rate limits per token.

#### CMDB-078 — Quick CI creation and wrong-CI feedback
- **Persian name:** ایجاد سریع CI و بازخورد CI نادرست
- **Tier:** P1 · **AI:** no
- **Sources:** JSM (quick creation of referenced objects), ITIL 4 (wrong CI associations reported back to configuration control), analytics (wrong-CI rate)
- **What and how:** Agents can create a missing CI from a task form (through the reconciliation engine, so duplicates are caught) and can flag "wrong CI" on a task, which records the corrected CI and opens a data-quality finding for the CI owner; wrong-CI rates are reported per class and source.
- **Build notes:** Mini form bound to the class's required fields; correction kept in task history (`ci_corrected_from`); finding kind wrong_ci.

#### CMDB-079 — CI tables embedded in knowledge and pages
- **Persian name:** جدول CI در مقاله‌های دانش و صفحه‌ها
- **Tier:** P2 · **AI:** no
- **Sources:** JSM (Assets macro in Confluence), ServiceNow (CI-linked knowledge)
- **What and how:** Knowledge articles and portal pages can embed a live table of CIs from a saved query with chosen attributes, trimmed to each reader's permissions.
- **Build notes:** Markdown extension `{{ci-table:<query_id> fields=...}}` rendered on the server through `readWhere`.

### Data model

Engine conventions: every table is a `TableDef` (physical name `sm_<key>`), carries the engine base columns (`id, org_id, number, workspace_id, domain_id, unit_id, created_*, updated_*, rev, deleted_at, origin, custom`) and is secured by the scope profile listed under "Access anchors". State categories follow the engine (new / active / waiting / resolved / closed / canceled).

| Table | Prefix | Purpose and key fields | States (category) | Access anchors |
|---|---|---|---|---|
| `ci` | CI | All configuration items. class, name, description, attrs (jsonb, validated per class), serial_number, asset_tag, model_id, manufacturer_id, owned_by, managed_by, support_group_id, managed_by_group_id, change_approval_group_id, company_id, location_id, cost_center_id, environment, criticality, tier, operational_status, install_status, discovery_source_id, first_discovered_at, last_discovered_at, is_stale, locked_attrs, attr_meta, supports_critical_function, max_criticality, maintenance_calendar_id, health (jsonb), tags | planned (new); on_order (waiting); build, test, operational, end_of_life (active); maintenance (waiting); retired, disposed (closed); canceled (canceled) | own: owned_by, managed_by · group: support_group_id, managed_by_group_id · unit: unit_id (subtree) · location: location_id (subtree) · company/domain: company_id, domain_id (+ used-by companies) · service: `st:` keys from `ci_service_closure` · workspace: workspace_id |
| `ci_class` | — | Class registry: key, parent_key, abstract, label_attr, icon, principal, create_disabled, attrs (FieldDef[]), lifecycle_model, health_cfg, rel_rules, controlled_attrs, asset_class, pack_version | config (active/inactive) | admin only |
| `ci_rel_type` | — | key, fwd_label, inv_label, symmetric, propagates, impact_direction, color | config | admin only |
| `ci_rel` | — | parent_ci_id, child_ci_id, type, origin (manual/discovery/rule/ai), source_id, discovered_at, last_seen_at, valid_from, valid_to, impact_weight | — (effective-dated) | readable when both endpoints are readable; otherwise redacted placeholder (CMDB-076); write needs `edit_relations` |
| `ci_rel_rule` | — | source_class, target_class, match condition, rel_type, mode | config | admin |
| `ci_rel_suggestion` | — | parent, child, type, evidence (jsonb), score, decided_by | proposed (new); accepted (closed); rejected (canceled) | as parent CI (owner reviews) |
| `ci_group`, `ci_group_member` | — | kind static/dynamic/redundancy, query AST, min_up, min_up_pct; materialized membership | config | as owning group |
| `ci_component` | — | ci_id, kind (cpu, memory, disk, nic, gpu, battery…), attrs, serial | — | as parent CI |
| `ci_attr_source` | — | ci_id, attr, source_id, value, observed_at | — | as CI; values of secret/security attributes masked |
| `ci_identification_rule`, `ci_reconciliation_rule`, `ci_refresh_rule` | — | class, ordered identifier entries, lookup tables, dependent parent; per-attribute source priorities; max data age per source | config | CMDB admin |
| `cmdb_data_source` | — | kind (file/url/api/connector/discovery/iac/federated), mapping, schedule, owner, priority, delete_policy, stale_after_days, health | config (active/paused) | CMDB admin, discovery admin |
| `import_set`, `import_row` | — | source, stage (raw/transformed/cleansed/reconciled), payload, status, error | — | CMDB admin |
| `cmdb_dedup_task` | DUP | candidates, main_ci_id, template_id, score, reason, assignment_group_id | new; in_progress (active); resolved; closed; canceled | group: assignment_group_id · CIs' anchors |
| `ci_merge_journal` | — | merge id, survivor, absorbed CIs, moved references (for undo) | — | CMDB admin |
| `cmdb_health_fact` | — | date, class, owner_group_id, metric, numerator, denominator | — | aggregate read for owners of the group/class |
| `cmdb_rule`, `cmdb_audit_run` | — | kind (data_quality/audit/coverage/dictionary), class, condition or query AST, severity, owner_field, category; run counts and failing ids snapshot | config | CMDB admin; results visible to CI owners |
| `cmdb_finding` | FND | rule_id, kind, ci_id, owner, due_at, detail | new; in_progress (active); resolved; closed; waived (canceled) | own: owner · group: CI support group |
| `cmdb_verification` | VER | plan, class, sample ids, results, accuracy, ci_low, ci_high | planned (new); in_progress (active); completed (resolved); closed | configuration manager |
| `ci_cert_campaign` / `ci_cert_task` | CRC / CRT | scope query, attributes, due; owner, CI list, answers | new; in_progress (active); resolved; closed; canceled | own: owner (task) |
| `cmdb_policy`, `cmdb_policy_run` | — | kind (retire/archive/delete/attest/certify), condition, schedule, approval; execution log with affected and skipped CIs | config | CMDB admin |
| `cmdb_scope_policy` | — | classes in scope, required/recommended attributes, ownership rules, review cadence (versioned) | config | configuration manager |
| `ci_baseline`, `ci_baseline_item` | BSL | scope, approved_by, approved_at; ci_id, attrs, rels snapshot | draft (new); approved (active); superseded (closed) | as scope CIs |
| `ci_drift` | DRF | ci_id, attr, expected, actual, source_id, change_id, decision | new; investigating (active); resolved (accepted/remediated); closed | group: CI support group |
| `ci_impact_sim` | — | inputs (CIs, hypothetical state), outputs, linked record | — | creator + linked record readers |
| `cmdb_map`, `cmdb_saved_query` | — | roots, filter, layout, audience; query AST + text | — | audience / owner |
| `discovery_collector`, `discovery_credential`, `credential_affinity` | — | collector capabilities, ranges, heartbeat, version, key fingerprint; encrypted secrets (type `secret`) | active/inactive | discovery admin; secrets readable by no user |
| `discovery_schedule`, `discovery_run`, `discovery_device_status`, `discovery_pattern`, `endpoint_agent` | DSC (run) | ranges, behaviour, credentials, collector; run counts and per-device status/errors; pattern steps; agent version/policy/last_seen | run: queued (new); running (active); completed (resolved); failed/canceled | discovery admin |
| `ci_service_closure` | — | service_ci_id, ci_id, depth (materialized, job-maintained) | — | internal (feeds `st:` keys) |
| `sbom`, `sbom_component`, `security_baseline` | — | ci_id, format, components (name, version, purl, cpe, license); baseline profile and compliance | — | as CI; security field group |
| `ci_archive` | — | archived CIs (same shape) | — | CMDB admin |

Specialized records are CI classes in `ci`, not separate tables: certificate, information_asset, data_flow, ip_prefix, ip_address, vlan, rack, cable, circuit, power_feed, cloud resources, Kubernetes objects, ai_system, ai_model, ai_agent, mcp_server, saas_app, business_service, technical_service, business_application.

**Relationships:** `ci.class → ci_class`; `ci.model_id → model` (ITAM) and `manufacturer_id → organization` (supplier); `asset.ci_id → ci` (1:1, ITAM); `ci_rel` parent/child → `ci`; `service.ci_id → ci` (service portfolio, 1:1); task tables (incident, problem, change, release, requested item, project) → `ci` via `ci_id` / `cis_involved` and `affected_services`; `software_install.ci_id → ci` (ITAM); `contract_coverage → ci` (supplier); `outage.ci_id → ci` (SLM/continuity); vulnerabilities → `ci` (security); `cost_entry.ci_id → ci` (financial).

**Access scoping:** CIs are anchored *live* (owner, groups, location, company follow the CI), so access keys are re-computed when anchors change. Configuration managers usually hold `all` within the IT workspace; CI owners `own`; support groups `group`; regional teams `location_subtree`; MSP domains `domain_subtree`. Requesters see a CI only through their own assets/requests.

### KPIs

| KPI | Formula | Notes |
|---|---|---|
| Completeness (required) | CIs with all required attributes filled ÷ CIs in class | Report recommended attributes separately |
| Correctness | 1 − (duplicates + orphans + stale) ÷ CIs | Per class and owner group |
| Compliance | CIs passing audit/certification ÷ CIs audited | From audit runs and certification tasks |
| CMDB health score | w₁·completeness + w₂·correctness + w₃·compliance | Weights per tenant; trend monthly |
| Staleness rate | CIs not seen by any source within the class threshold ÷ discoverable CIs | Thresholds 30/60/90 days |
| Duplicate rate | CIs in open de-duplication tasks ÷ CIs | |
| Orphan rate | CIs violating required-relationship rules ÷ CIs of classes with such rules | |
| Discovery coverage | discovered CIs ÷ known CIs (AD, ITAM, cloud accounts) | Also managed vs unmanaged devices |
| Discovery error rate | failed device probes ÷ attempted probes | Per collector and error class |
| Relationship coverage | CIs with ≥ 1 relationship ÷ CIs (classes that need them) | |
| Service-mapping coverage | business services with mapped dependencies ÷ business services | Target 100% for Tier 1 |
| Verified accuracy | matches ÷ sample size, with 95% CI = p ± 1.96·√(p(1−p)/n) | Per class, per verification cycle |
| Certification on time | certification tasks completed by due date ÷ tasks due | |
| CI-populated rate | incidents (changes) with a valid CI ÷ incidents (changes) | Target ≥ 90% |
| Wrong-CI rate | tasks whose CI was corrected ÷ tasks with a CI | Per class and source |
| Unauthorized changes | drift records not linked to an approved change, per month | |
| Baseline compliance | controlled CIs matching the approved baseline ÷ controlled CIs | |
| CMDB data usage rate | tasks referencing a CI or service ÷ tasks | ITIL v5 metric |
| Data-quality remediation time | avg(closed_at − opened_at) of findings | |
| Certificate expiry exposure | certificates expiring within 30 days without a renewal task | |
| AI suggestion acceptance | accepted ÷ (accepted + rejected) AI proposals (dedup, relationships, enrichment) | Per skill; drives auto-apply thresholds |

### Beyond the market

- **Persian-native graph questions.** Natural-language CMDB search and CI summaries in Persian, with Persian text normalization (ی/ي، ک/ك، نیم‌فاصله، Persian/Arabic digits) and RTL-correct graph labels; no leading tool offers this.
- **The Windows app as collector and offline CMDB.** The desktop app can host the discovery collector (outbound-only, no MID-server VM) and keeps a permission-exact offline replica, so engineers in data centres without internet can read dependency maps, scan devices and create CIs, then sync.
- **Relationship suggestions with evidence.** Observed-connection, co-occurrence and config-parsing suggestions are an open gap in the market (CMDB-041); combined with the AI governor they make the CMDB maintain itself rather than decay.
- **Data sovereignty for topology.** Topology is among the most sensitive data a company has; all AI over the graph can run on the tenant's own local model, and nothing needs to leave the country — important for critical infrastructure and passive-defence requirements.
- **Local connectors.** Ready connectors for tools common in Iran (Kaspersky Security Center, ESET, Padvish, Iranian clouds such as ArvanCloud, local virtualization) that global vendors do not ship.
- **Critical-function propagation for local regulators.** The same propagation used for EU DORA produces dependency maps for critical-infrastructure and passive-defence reviews and for regulators such as the Central Bank's IT requirements.
- **Alerts where people are.** Drift, certificate expiry and data-quality tasks reach CI owners through SMS gateways and Bale/Eitaa/Telegram bots, not only email; renewal deadlines respect Jalali dates and Iranian holidays.
- **One permission model across graph, AI, exports and offline.** Restricted CIs appear as anonymous placeholders in maps and AI answers — leading tools either leak names or break paths.

## Module: itam — مدیریت دارایی‌های فناوری اطلاعات (سخت‌افزار، نرم‌افزار، SaaS)

### Features

#### ITAM-001 — Asset register and asset classes
- **Persian name:** دفتر دارایی‌ها و کلاس‌های دارایی
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (alm_asset classes), Freshservice (assets), ManageEngine SDP (product types), BMC Helix, JSM HAM (hardware register), Snipe-IT, GLPI, ITIL 4 (asset record), ISO/IEC 19770-1, ISO/IEC 27001 A.5.9
- **What and how:** The asset is the financial and contractual record, separate from the CI (the operational record). Classes: hardware, consumable, accessory, component, software entitlement, SaaS subscription, mobile device, peripheral and non-IT. Fields: asset tag, serial number, model, class, state and substate, assigned to, managed by, owning unit, location, stockroom, cost centre, company, purchase data (PO line, vendor, cost, currency, purchase date, invoice), warranty end, contracts, lease, depreciation (rule, salvage, current book value), lifecycle dates (received, deployed, retired, disposed), disposal method and certificate, compliance flags (encrypted, MDM enrolled), acknowledgement status and audit dates. Assets without CIs (consumables) and CIs without assets (services) are both allowed.
- **Build notes:** `asset` (number AST) with engine base columns; class drives form sections and the state model; money fields in field group financial; `ci_id` unique and nullable for the 1:1 link.

#### ITAM-002 — Asset and CI synchronization
- **Persian name:** همگام‌سازی دارایی و CI
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (asset ↔ CI sync), ManageEngine SDP (sync rules), BMC, ITIL 4 (asset vs CI views), standards (asset is financial, CI is operational)
- **What and how:** For classes that are both an asset and a CI, the two records are linked 1:1 and shared fields sync both ways with a defined master per field (serial and model from discovery, cost and assignment from ITAM, location from the most trusted source). Lifecycle rules keep them consistent (asset retired → CI retired; a discovered CI with no asset → asset created as "in use, unverified"). Conflicts are logged rather than silently overwritten.
- **Build notes:** `asset_ci_sync_rule` (field, master asset|ci|source priority); sync inside `afterWrite` hooks of both tables in the same transaction, with an origin flag to prevent loops.

#### ITAM-003 — Product model catalogue
- **Persian name:** کاتالوگ مدل‌های کالا
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (cmdb_model, Content Service), JSM HAM (model catalogue), Freshservice (product catalog, vendor price lists), ManageEngine SDP (product catalog), Snipe-IT (models with EOL), BMC (Product Catalog)
- **What and how:** Models for hardware, software, consumables and facilities: manufacturer, model number/SKU, category (→ CI class and asset class), form factor, specifications, release date, end of life, end of support, standard warranty months, weight, power and image; status Approved / Under review / Exception / Deprecated / Prohibited; procurement mode Buy / Lease / Both; default depreciation rule and useful life; vendor price lists (vendor, price, currency, warranty, lead time, valid from). Models drive catalogue items, purchase orders, stock rules and refresh; assets reference the model instead of copying its data; models can be imported from CSV.
- **Build notes:** `model` (number MDL), `model_category`, `model_vendor_price`; manufacturer references `organization`; status gates catalogue and PO lines (prohibited models are blocked).

#### ITAM-004 — Hardware standards and approved configurations
- **Persian name:** استانداردهای سخت‌افزاری و پیکربندی‌های مصوب
- **Tier:** P1 · **AI:** no
- **Sources:** JSM (Assets CDM hardware standards library), ServiceNow (model categories, standard catalog items), ITIL 4 (vendor catalogues)
- **What and how:** Standard configurations per role (office laptop, developer laptop, executive kit, field tablet) with approved models, specifications, accessories and software bundle and a refresh cycle; exceptions need approval. Used by the request catalogue, procurement and refresh campaigns.
- **Build notes:** `hardware_standard` (persona, models[], accessories[], software[], refresh_months, exception approval rule).

#### ITAM-005 — AI hardware model normalization
- **Persian name:** یکسان‌سازی هوشمند مدل‌های سخت‌افزار
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (HAM daily model normalization, Content Service), BMC (Normalization Engine), ai research (normalization pipeline)
- **What and how:** A daily job normalizes discovered manufacturer, product, model and device-type strings ("HP", "Hewlett-Packard", "HPE") against the content library and an alias table. It never adds, merges or deletes models and never changes the original fields. Unknown strings go through embedding search and LLM adjudication with a confidence score and a review queue; approved decisions grow the alias table.
- **Build notes:** `model_alias` (raw → model_id, source rule|ai|human); exact/alias → regex rules → kNN (k=10) → LLM over the top 5 returning {model_id|null, confidence, reason} → auto-map at ≥ 0.95, otherwise review queue.

#### ITAM-006 — Model lifecycle dates with AI approximation
- **Persian name:** تاریخ‌های چرخهٔ عمر مدل با برآورد هوشمند
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (approximated lifecycle dates), InvGate (Atlas supplies EOS/EOL dates), JSM HAM (model EOL/EOS)
- **What and how:** End of sale, end of support and end of extended support for every model, from the content library or the vendor. When a manufacturer does not publish them, AI estimates them from release date, product-family history and similar models, marks them "approximated" with evidence and confidence, and the asset manager confirms. These dates drive refresh planning and technology risk.
- **Build notes:** `model.eol_date/eos_date` + `lifecycle_source` (vendor|content|approximated|manual) + evidence json; estimation is a skill whose output is a proposal.

#### ITAM-007 — Asset states, substates and lifecycle designer
- **Persian name:** وضعیت‌ها و زیروضعیت‌های دارایی و طراح چرخهٔ عمر
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (install_status + substate), JSM HAM (hardware statuses), Freshservice (asset states), ManageEngine SDP (drag-and-drop lifecycle, To Be Returned), BMC (asset statuses), Snipe-IT, ITIL 4 (hardware lifecycle), COBIT BAI09.03
- **What and how:** State with substate: On order; In stock (available, reserved, defective, pending repair, pending install, pending disposal, pending transfer); In transit; Being prepared; In use; On loan; In repair (internal, vendor RMA); Missing (lost, stolen); To be returned; Pending disposal; Retired (disposed, sold, donated, vendor credit, returned to vendor, consumed). Transitions carry requirements (In use needs an assignee; Disposed needs sanitization evidence) and permissions, and admins can design lifecycles per class in a drag-and-drop editor. Asset state stays separate from the state of the work item that changes it; automation maps work outcomes to asset transitions (shipping completed → In use; return received → In stock).
- **Build notes:** `asset.state` (categories: in_stock=new; on_order, in_transit, in_repair, missing, to_be_returned=waiting; preparing, in_use, on_loan=active; pending_disposal=resolved; retired, consumed=closed; canceled) plus dependent `substate`; per-class StateModel; flow templates map task events to transitions.

#### ITAM-008 — Assignment and check-out/check-in ledger
- **Persian name:** تحویل و بازپس‌گیری دارایی (دفتر جابه‌جایی)
- **Tier:** P0 · **AI:** no
- **Sources:** Snipe-IT (check-out to user, location or asset with expected check-in), ServiceNow (assigned to), Freshservice (used by, Permanent/Loaner), ManageEngine SDP (assign to users, departments, sites), ITIL 4
- **What and how:** Assets are checked out to a user, department, location, cost centre or another asset (a monitor to a desk, a disk to a server) with an assignment date and optional expected return date; check-in returns them to a stockroom with condition notes. Usage type is Permanent or Loaner. Every movement is logged with who did it and why; bulk check-out supports onboarding waves; for quantity-tracked items available = quantity − open check-outs.
- **Build notes:** Polymorphic `asset_checkout` (item_type, item_id, qty, target_type user|unit|location|asset, target_id, out_at, expected_in_at, in_at, condition, acceptance_id, task_id); `asset.assigned_to` is derived from the open check-out.

#### ITAM-009 — My assets (requester and manager views)
- **Persian name:** دارایی‌های من (نمای درخواست‌کننده و مدیر)
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (requester assets widget), ManageEngine SDP (My Assets tab, Asset Allocation Details), JSM (portal Assets field), access research (requesters see assigned assets)
- **What and how:** Requesters see the assets, software, licences and consumables assigned to them on the portal and in their profile, can report "not mine", lost or broken, and pick their own device in requests; managers see their team's or department's assets.
- **Build notes:** Portal page over `asset` with scope own (assigned_to) and reportees or unit for managers; actions open preset request types.

#### ITAM-010 — Asset acknowledgement and acceptable use
- **Persian name:** رسید و تعهدنامهٔ استفادهٔ مجاز از دارایی
- **Tier:** P1 · **AI:** yes
- **Sources:** Snipe-IT (EULA acceptance with signature and PDF), ManageEngine SDP (acknowledgement forms with reminders, GenAI processing of email replies), ISO/IEC 27001 A.5.10
- **What and how:** Categories or models can require acceptance. On check-out the user receives an acknowledgement (portal, email, SMS or messenger) with the terms and asset details, accepts or declines with a drawn signature or one-time code, and a signed PDF is stored on the asset; reminders and a report of unaccepted assets follow. AI reads email replies and classifies them as accept, decline or dispute.
- **Build notes:** `asset_acceptance` (number ACK; pending=waiting → accepted=closed, declined=resolved, expired=canceled; signature, pdf blob); OTP through the SMS gateway; reply classification skill.

#### ITAM-011 — Leaver return and reclamation
- **Persian name:** بازپس‌گیری دارایی‌های کارکنان خروجی
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (reclamation for leavers via HR offboarding), JSM HAM (collect hardware from employee), ManageEngine SDP (To Be Returned for deleted users), ISO/IEC 27001 A.5.11
- **What and how:** When HR or the directory marks a leaver (or a role change), the system lists every asset, licence and SaaS seat of that person, sets hardware to "to be returned", creates collection or shipping tasks with a leaver checklist (device, badge, tokens, data wipe), reclaims licences and escalates items not returned by the deadline.
- **Build notes:** Triggered by user deactivation or a journey event; a flow template creates tasks per assigned item; unreturned items are flagged in reports; licence reclamation reuses ITAM-061.

#### ITAM-012 — Loaner pool and reservations
- **Persian name:** دارایی‌های امانی و رزرو
- **Tier:** P1 · **AI:** no
- **Sources:** Freshservice (loaner usage type, loaner catalog items with dates, overdue reminders), ManageEngine SDP (asset loans, booking permission), Snipe-IT (expected check-in)
- **What and how:** Loaner pools per model and location with an availability calendar; users book from/to dates through the catalogue; check-out and check-in at pickup and return; overdue reminders and escalation; loaners are issued automatically during repairs.
- **Build notes:** `asset_reservation` (asset or model, user, from, to, state); Jalali calendar widget; overdue job.

#### ITAM-013 — Stockrooms
- **Persian name:** انبارها
- **Tier:** P0 · **AI:** no
- **Sources:** JSM HAM (stockrooms with type, manager, parent), ServiceNow (stockrooms), ManageEngine SDP (sites), Freshservice (inventory by location)
- **What and how:** Stockrooms with a type (central warehouse, regional depot, on-site storage, secure room, IT kiosk, van stock, disposal area), location, manager and parent stockroom, forming a hierarchy; each shows stock per model and state. Stockroom managers act only on their own stockrooms.
- **Build notes:** `stockroom` (type, location_id, manager_id, parent_id); scope location_subtree anchored on the stockroom location; a move between stockrooms needs rights on both.

#### ITAM-014 — Stock levels and movement ledger
- **Persian name:** موجودی انبار و دفتر گردش کالا
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (inventory, add to inventory), ServiceNow (stockroom operations), ManageEngine SDP (consumables by site), access research
- **What and how:** Counts per model, stockroom and state, plus a ledger of every movement (receive, issue, return, transfer out/in, adjust, consume, dispose) with quantity, reason, user and linked task. Adjustments above a threshold need approval, and stock can be viewed as of any date.
- **Build notes:** Immutable `stock_movement` ledger (corrections by reversal entries only); `stock_level` maintained per (model, stockroom, state) by triggers or a materialized view.

#### ITAM-015 — Stock rules and replenishment
- **Persian name:** قواعد موجودی و تأمین مجدد
- **Tier:** P1 · **AI:** no
- **Sources:** JSM HAM (stock rules min/max/order size), ServiceNow (stock rules), ManageEngine SDP (low-stock notifications), Snipe-IT (minimum quantity alerts)
- **What and how:** Per model and stockroom: minimum (reorder point), maximum (restock target) and order size. Rules are checked on every movement and on schedule; a breach creates one replenishment task or purchase requisition per period and notifies the stockroom manager.
- **Build notes:** `stock_rule` (model, stockroom, min, max, order_qty); checked in the movement hook and nightly; idempotent key = rule + period.

#### ITAM-016 — Transfer orders and shipping
- **Persian name:** دستور انتقال و ارسال
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (transfer orders), JSM HAM (ship, transfer, process inventory transfers), Freshservice
- **What and how:** Transfer orders move stock or specific assets between stockrooms or to users: lines, carrier and tracking number, shipped (in transit) and received (partial allowed) steps, automatic sub-location updates and printable Persian waybills.
- **Build notes:** `transfer_order` (number TRO; draft=new → shipped=waiting → partially_received=active → received=resolved → closed; canceled) with lines; ledger movements written on ship and receive.

#### ITAM-017 — Consumables and accessories
- **Persian name:** اقلام مصرفی و لوازم جانبی
- **Tier:** P1 · **AI:** no
- **Sources:** Snipe-IT (consumables, accessories), ManageEngine SDP (consumables by site, allocation, replenishment), ServiceNow (consumables), Freshservice (consumable types)
- **What and how:** Consumables (toner, cables, batteries) are issued and never returned; accessories (headsets, docks, mice) are reusable, tracked by quantity and checked out to people, locations or assets. Both have minimum-quantity alerts, allocation by site and cost-per-user and per-department reports.
- **Build notes:** Quantity-tracked `asset` rows (class consumable or accessory, qty) using the movement ledger and check-out table; consumption posts cost entries.

#### ITAM-018 — Components and sub-assets
- **Persian name:** قطعات و زیردارایی‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** Snipe-IT (components installed into assets), Freshservice (discovered components), ManageEngine SDP (components, processor details), BMC (component failure history)
- **What and how:** Components (memory, disks, GPUs, batteries) installed into assets with install, remove and swap history, reconciled with the components discovery reports; parent/child relations between assets (a docking station with a laptop, a server with its disks); component failure history feeds forecasting.
- **Build notes:** Components as `asset` rows with `parent_asset_id` or quantity check-outs to an asset; discovered components (`ci_component`) matched to tracked ones by serial.

#### ITAM-019 — Kits and bundles
- **Persian name:** بسته‌های تجهیزات
- **Tier:** P2 · **AI:** no
- **Sources:** Snipe-IT (predefined kits), others (requestable assets and kits)
- **What and how:** Predefined kits bundle models, licences, accessories and consumables (laptop + bag + mouse + Office licence) that are requested and checked out together.
- **Build notes:** `kit` + `kit_item`; checking out a kit expands to individual check-outs in one transaction.

#### ITAM-020 — Catalogue items bound to models and live stock
- **Persian name:** پیوند اقلام کاتالوگ با مدل‌ها و موجودی زنده
- **Tier:** P1 · **AI:** no
- **Sources:** InvGate (catalog product bound to stock), ServiceNow (asset-linked requests), Snipe-IT (requestable assets), Freshservice (fulfilment decrements stock)
- **What and how:** A catalogue item maps to one or more models in order of preference and shows live availability. At fulfilment a unit is soft-reserved, the agent assigns a specific asset, stock is decremented and history is linked to the request; when nothing is in stock the flow falls back to a transfer or a purchase requisition.
- **Build notes:** `catalog_item_model(catalog_item_id, model_id, preference)`; stock = count of in-stock assets per model; reserved substate with expiry.

#### ITAM-021 — Prebuilt ITAM request types and work templates
- **Persian name:** انواع درخواست و الگوهای کار آمادهٔ مدیریت دارایی
- **Tier:** P0 · **AI:** no
- **Sources:** JSM HAM (request new hardware, repair, configuration, refresh; ship, collect, transfer, procure, fulfil, dispose, audit; report broken hardware), Freshservice (asset lifecycle workflows), ServiceNow (HAM workspace processes)
- **What and how:** Ready request types and task templates: request new hardware or software, report broken or lost hardware, repair, configuration, refresh, return; and management work: procure, receive, ship, collect from employee, transfer, prepare and image, dispose, perform audit. Each links to its asset, model or stockroom and runs a workflow with Persian forms.
- **Build notes:** Seed catalog items and task templates in the ITAM workspace; asset references on forms; task states mapped to asset transitions (ITAM-007).

#### ITAM-022 — Prebuilt ITAM flow templates
- **Persian name:** جریان‌های خودکار آمادهٔ مدیریت دارایی
- **Tier:** P1 · **AI:** no
- **Sources:** JSM HAM (hardware automation templates), Freshservice (Workflow Automator asset lifecycle), ServiceNow (HAM lifecycle automation)
- **What and how:** Ready automations: fulfil hardware requests (find in stock or procure, ship, set status and assignee), process shipments and transfers, process returns (receive, wipe, restock), coordinate refreshes, process disposals (route by method), route repairs (internal, external or vendor by warranty), provision and configure devices through endpoint tools, replenish stock. Triggers can be request-driven, scheduled, event-driven or bulk.
- **Build notes:** Flow definitions shipped as versioned templates that tenants copy and edit.

#### ITAM-023 — AI hardware request fulfilment agent
- **Persian name:** عامل هوشمند انجام درخواست سخت‌افزار
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Help manage hardware asset requests agentic workflow: sourcing, transfer order, purchase order and repair agents)
- **What and how:** An agent works hardware requests: checks stock against the hardware standard, chooses between local stock, a transfer from another stockroom or a purchase requisition (cost and lead time), drafts the transfer or PO, or routes a repair by warranty. Every action is a proposal with reasoning for the asset manager to confirm.
- **Build notes:** Agent with tools over stock, models, transfer orders, requisitions and warranty; autonomy "propose"; run-as procurement role.

#### ITAM-024 — Purchase requisitions
- **Persian name:** درخواست خرید
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (purchase requisitions from catalog requests), BMC (purchase requisitions), ManageEngine SDP (purchase requests), COBIT APO06, access research (purchase segregation of duties)
- **What and how:** Requisitions come from catalogue requests, stock rules or manual entry with lines (model, quantity, estimated cost, cost centre, budget line). A budget check runs before approval; approvals follow the amount-based authority matrix (financial module) with segregation of duties (requester ≠ approver); approved requisitions turn into one purchase order per vendor.
- **Build notes:** `purchase_requisition` (number PRQ; draft=new → pending_approval=waiting → approved=active → ordered=resolved → closed; rejected, canceled=canceled) with lines; approvals through the shared engine.

#### ITAM-025 — Purchase orders
- **Persian name:** سفارش خرید
- **Tier:** P1 · **AI:** no
- **Sources:** Freshservice (purchase orders), ManageEngine SDP (POs with GL codes, cost centres, multi-currency, PO PDF), ServiceNow (purchase orders), BMC
- **What and how:** PO number, vendor, currency and exchange rate, expected delivery, department and cost centre, billing and shipping addresses, lines (item type, model, quantity, unit cost, tax %, discount, GL code, cost centre), shipping cost, totals and terms; states Open → Pending approval → Ordered → Partially received → Received → Closed or Cancelled; approval; an official Persian PDF emailed to the vendor; links to the requests it fulfils; templates and part-number search.
- **Build notes:** `purchase_order` (number PO) + `purchase_order_line` (ordered_qty, received_qty); status derived from line quantities; money as amount + currency + base amount; Procurement Manager role.

#### ITAM-026 — Receiving and asset intake
- **Persian name:** دریافت کالا و ثبت دارایی
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (receive items, convert to assets, add to inventory), ServiceNow (receiving incl. mobile; asset creation on receipt), ManageEngine SDP (bulk creation from barcodes), ITIL 4 (receipt → asset → deployment task)
- **What and how:** Goods are received against PO lines (partly or fully) or as an ad-hoc delivery. Received lines become assets through a grid where serial numbers and asset tags are scanned or typed; consumables are added to stock; deployment tasks are created. Receiving works on mobile and in the Windows app with a USB scanner.
- **Build notes:** `goods_receipt` (number GRN) + lines; creates `asset` rows pre-filled from the model and PO line in one transaction; updates `received_qty`; writes stock movements.

#### ITAM-027 — Advance shipping notice import
- **Persian name:** ورود اعلامیهٔ ارسال فروشنده
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (ASN import in HAM)
- **What and how:** Vendor shipping notices (file or API) pre-create expected assets with serial numbers so receiving becomes a scan-and-confirm step.
- **Build notes:** `asn` + `asn_line` matched to PO lines; mismatches flagged at receipt.

#### ITAM-028 — Asset tags and barcode/QR labels
- **Persian name:** برچسب اموال، بارکد و QR
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (QR code printing), ManageEngine SDP (label editor, barcode/QR generation, bulk creation from barcodes), Freshservice (printable tags, mobile scanning), BMC (mobile barcode scanning), Snipe-IT
- **What and how:** Asset-tag numbering patterns per class or company; a label designer (fields, Code 128, QR or DataMatrix, sizes in millimetres, Persian text and logo) with batch printing to PDF. A QR code opens the asset page; scanning with a phone camera, webcam or USB scanner finds or updates an asset; up to 100 assets can be created from scanned barcodes at once.
- **Build notes:** `label_template`; server-side PDF rendering with a Persian font (platform print layouts, PLT-027); QR payload = signed short link; numbering through the engine's numbering service.

#### ITAM-029 — Physical inventory audits
- **Persian name:** انبارگردانی و ممیزی فیزیکی
- **Tier:** P0 · **AI:** no
- **Sources:** InvGate (location-scoped audits, Found / Missing / Others), ServiceNow (unified inventory audit with mobile scanning), Snipe-IT (last/next audit dates, due and overdue lists), ManageEngine SDP (technician audits), ITIL 4 (audits and counts), ISO/IEC 19770-1
- **What and how:** Audit sessions are scoped by location, stockroom, class or cost centre. The expected set is compared with what is scanned: found, missing, moved (wrong location), unexpected (not in the register) or wrong state; assets found during the audit can be created on the spot and sub-locations updated automatically. Closing the audit stamps each asset with date, location and result and sets the next audit date from the category interval; discrepancy tasks follow and the result is kept as evidence.
- **Build notes:** `inventory_audit` (number AUD; planned=new → in_progress=active → reconciling=active → completed=resolved → closed; canceled) + `inventory_audit_item` (asset, expected_location, result, scanned_at, scanned_by); `asset.last_audit_at/next_audit_at/last_audit_result`.

#### ITAM-030 — RFID bulk audits
- **Persian name:** ممیزی گروهی با RFID
- **Tier:** P2 · **AI:** no
- **Sources:** InvGate (RFID readers), ManageEngine SDP (RFID bulk scans via iPhone app)
- **What and how:** RFID readers (handheld or phone accessory) scan many tags at once; tag EPCs map to assets and results feed the same audit reconciliation.
- **Build notes:** EPC field on `asset`; reader integration through the mobile or Windows app.

#### ITAM-031 — Offline audits and scanning
- **Persian name:** انبارگردانی و اسکن بدون اتصال به شبکه
- **Tier:** P1 · **AI:** no
- **Sources:** platform (Windows offline replica), BMC (FSM mobile offline mode), standards (audit evidence)
- **What and how:** The Windows and mobile apps download the expected set of an audit, work without network in warehouses, basements or remote sites, record scans with timestamps and sync when connectivity returns, with conflict handling if the same asset changed meanwhile.
- **Build notes:** Audit scope added to the user's sync buckets; scans stored locally as `inventory_audit_item` drafts; merged on sync with server-side conflict rules. Relies on the platform sync engine and Windows offline replica (PLT-072, PLT-073).

#### ITAM-032 — Requester self-audit
- **Persian name:** خوداظهاری کاربران دربارهٔ دارایی‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (requester self-audits), ISO/IEC 27001 A.5.9
- **What and how:** Periodic campaigns ask users to confirm the assets they hold (portal, email or messenger), optionally with a photo of the serial label; mismatches open tasks and non-responders are escalated; results raise audit coverage between physical counts.
- **Build notes:** Campaign over `asset` grouped by assigned_to; answers stored as `inventory_audit_item` with method self.

#### ITAM-033 — Deployment and provisioning tasks
- **Persian name:** آماده‌سازی و استقرار دارایی
- **Tier:** P1 · **AI:** no
- **Sources:** JSM HAM (provision and configure hardware via device management), Freshservice (fulfilment workflows), ServiceNow (HAM lifecycle), ITIL 4 (deploy)
- **What and how:** Assignment triggers provisioning: imaging, MDM enrolment, configuration profiles, software install, shipping and handover with acknowledgement; integrations with endpoint tools (Intune, SCCM) apply policy and report completion back to the task.
- **Build notes:** Flow template with tasks and HTTP steps to endpoint tools; completion moves the asset to In use.

#### ITAM-034 — Warranty and support coverage
- **Persian name:** پوشش گارانتی و پشتیبانی
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (coverage checks during incidents), Freshservice (warranty expiry notifications), JSM HAM (route repairs by warranty status), ServiceNow (warranty expiration), standards (warranty and lease expiry alerts)
- **What and how:** Warranty start and end, provider and type (manufacturer, extended, local warranty company), coverage level and the support or maintenance contracts covering the asset. Incidents show "under warranty until …" next to the CI; expiry notifications and lists of assets leaving warranty are produced.
- **Build notes:** `asset.warranty_*` fields + `contract_coverage` (supplier module); the incident side panel reads coverage; scheduled notification rule.

#### ITAM-035 — Repair and RMA
- **Persian name:** تعمیر و ارسال به گارانتی (RMA)
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (repair and RMA lifecycle), JSM HAM (route repairs internal/external/vendor), ManageEngine SDP, BMC (field inventory history)
- **What and how:** "Report broken hardware" creates a repair order routed to the internal workshop, an external repairer or the vendor (RMA) depending on warranty. It tracks RMA number, shipment, vendor ticket, repair cost and a loaner; the asset stays In repair until it returns; defect history is kept per model.
- **Build notes:** `repair_order` (number RMA; new → diagnosing=active → awaiting_vendor, awaiting_parts=waiting → repaired, beyond_repair=resolved → closed; canceled).

#### ITAM-036 — Refresh planning and campaigns
- **Persian name:** برنامه‌ریزی و اجرای نوسازی تجهیزات
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (refresh by age or EOL), JSM HAM (coordinate hardware refreshes), InvGate (devices due for replacement), COBIT BAI09.04 (refresh timing on TCO; redeploy before buy)
- **What and how:** Candidates by age, end of support or life, warranty end, incident count and performance; a quarterly refresh forecast for budgeting; campaigns in waves that order, prepare, swap, collect and wipe old devices and redeploy or dispose of them; redeploy-before-buy checks reuse returned stock first.
- **Build notes:** `refresh_campaign` (number RFR) with a candidate query and waves; the forecast feeds budget lines in the financial module.

#### ITAM-037 — Predictive failure and refresh forecasting
- **Persian name:** پیش‌بینی خرابی و نیاز به نوسازی
- **Tier:** P2 · **AI:** yes
- **Sources:** ITIL 4 (refresh forecasting from failure data), standards (failure and refresh prediction from telemetry), BMC (component failure history)
- **What and how:** Predicts failure probability per asset from age, model failure history, incident counts, battery health and disk SMART data reported by the agent, and forecasts spare-part demand and refresh needs; each prediction lists its main factors.
- **Build notes:** Survival or gradient-boosted model trained per tenant (fallback: model-level hazard rates); scores stored in `asset.failure_risk`; the LLM writes the explanation.

#### ITAM-038 — Secure disposal
- **Persian name:** اسقاط و واگذاری امن
- **Tier:** P0 · **AI:** no
- **Sources:** ISO/IEC 27001 A.7.14 and A.8.10, ServiceNow (disposal stages, e-waste vendors, certificates, resale for credit), JSM HAM (process hardware disposals), ITIL 4 (secure disposal), standards (NIST SP 800-88 evidence before Disposed)
- **What and how:** Disposal orders group assets with a method (recycle, resell, donate, destroy, lease return, vendor credit). Data sanitization is recorded per asset (clear, purge or destroy per NIST SP 800-88; tool, operator, date, verification), and a certificate of destruction or wipe report is mandatory before an asset can become Disposed. Certified e-waste vendor, chain-of-custody handovers with signatures, environmental records and resale value or credit are kept.
- **Build notes:** `disposal_order` (number DSP; requested=new → approved=active → sanitizing=active → awaiting_certificate=waiting → disposed=resolved → closed; canceled) + `disposal_item` (sanitization fields, certificate blob); transition guard on asset → disposed.

#### ITAM-039 — Lost and stolen devices
- **Persian name:** دستگاه‌های مفقود و سرقت‌شده
- **Tier:** P1 · **AI:** no
- **Sources:** Zendesk (remote lock and erase via MDM), ServiceNow (Missing → Lost/Stolen), ISO/IEC 27001
- **What and how:** Users report a lost or stolen device on the portal; the asset becomes Missing (lost or stolen), a security incident is opened, an approved MDM remote lock or wipe is triggered, a police report can be attached and the write-off goes to the financial module.
- **Build notes:** Request type + flow; MDM action through a connector with approval; a cost entry records the write-off.

#### ITAM-040 — Device context and remote actions in tickets
- **Persian name:** اطلاعات دستگاه و اقدام از راه دور در تیکت
- **Tier:** P1 · **AI:** no
- **Sources:** Zendesk ITAM (owner, location, warranty, condition in the ticket; remote lock/erase), BMC (remote support), ManageEngine SDP (remote control add-on, TeamViewer), Atera and Ivanti (RMM actions)
- **What and how:** The ticket side panel shows the caller's device: model, owner, warranty, condition, last seen, compliance and recent changes. Agents can run approved actions through connected MDM or RMM tools — lock, wipe, restart, run a script, start a remote-control session — and every action is audited.
- **Build notes:** Side widget on task forms reading `asset` and `ci`; actions are flow steps calling connectors, gated by approval rules and logged in the journal.

#### ITAM-041 — Lease management
- **Persian name:** مدیریت دارایی‌های اجاره‌ای (لیزینگ)
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (lease contracts), Freshservice (lease contract type), BMC (lease contracts), ManageEngine SDP, ISO 55001 (residual value)
- **What and how:** Leased assets link to a lease contract with its schedule, monthly cost and end date. Before the end, tasks propose return, buy-out or extension; return condition and penalties are recorded and lease costs flow to the financial ledger.
- **Build notes:** `contract` of type lease (supplier module) + `contract_coverage`; a lease-end flow runs 90/60/30 days before the end.

#### ITAM-042 — Depreciation
- **Persian name:** استهلاک
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (depreciation types), ManageEngine SDP (four methods at product or asset level), JSM HAM (depreciation rules, book value), Snipe-IT (straight line with floor), GLPI (amortization type and period), BMC, ITIL 4 (book value is derived)
- **What and how:** Methods: straight line, declining balance, double declining balance and sum-of-years' digits, plus tenant-defined rate tables (such as the Iranian tax depreciation table), set per model, class or asset with useful life (months or years) or annual rate and salvage value. Book value is computed, never typed; each asset shows its depreciation schedule; monthly snapshots support reporting and are posted to the financial ledger.
- **Build notes:** `depreciation_rule` (method, life_months or rate, salvage_pct, start purchase|in_service); calculators are pure functions; monthly job writes `asset_value_snapshot`; posting via financial cost entries.

#### ITAM-043 — TCO and repair-vs-replace
- **Persian name:** هزینهٔ کل مالکیت و تصمیم تعمیر یا جایگزینی
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (TCO), analytics (TCO formula), COBIT BAI09.04, GLPI (TCO)
- **What and how:** Total cost of ownership per asset, model, user and service = acquisition + deployment + operation (support, maintenance, repairs, energy, licences, hosting) + disposal − residual value. A repair-vs-replace hint compares repair cost and remaining life with the cost of replacement.
- **Build notes:** Aggregates over financial cost entries by asset; rule-based recommendation with thresholds.

#### ITAM-044 — Critical asset maintenance plans
- **Persian name:** برنامهٔ نگهداری دارایی‌های حیاتی
- **Tier:** P2 · **AI:** no
- **Sources:** COBIT BAI09.02 (critical assets), ISO 55001, ServiceNow (EAM maintenance), BMC
- **What and how:** Assets flagged critical (UPS, generators, core switches, storage) get preventive maintenance plans, spare-part lists, support contracts and risk treatment; maintenance work orders are scheduled from the plans.
- **Build notes:** `maintenance_plan` (asset or model, interval, checklist) generating tasks through the schedule service.

#### ITAM-045 — Enterprise and non-IT assets
- **Persian name:** دارایی‌های غیر فناوری اطلاعات
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (Enterprise Asset Management), TOPdesk (facilities), GLPI (custom assets)
- **What and how:** Non-IT asset classes (furniture, facility equipment, vehicles, OT and medical devices) reuse models, stockrooms, audits, depreciation and disposal in other workspaces.
- **Build notes:** Class packs per workspace; no extra engine work.

#### ITAM-046 — Removable media and off-premises equipment registers
- **Persian name:** ثبت رسانه‌های جداشدنی و تجهیزات خارج از سازمان
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC 27001 A.7.9/A.7.10/A.7.13
- **What and how:** Registers of removable media (USB disks, tapes) and of equipment taken off premises (laptops on trips), plus equipment maintenance records, with authorization and return checks.
- **Build notes:** Asset classes + check-out to location "off-premises" with approval; reports.

#### ITAM-047 — Mobile devices and SIM tracking
- **Persian name:** گوشی‌ها و سیم‌کارت‌ها
- **Tier:** P2 · **AI:** no
- **Sources:** Freshservice (mobile devices), ServiceNow, Zendesk (MDM), local context (Iranian device registry)
- **What and how:** Phones and tablets with IMEI/MEID, phone number, carrier, SIM or eSIM, MDM enrolment and compliance; the registration status of each IMEI in the Iranian device registry (Hamta) can be recorded.
- **Build notes:** Class mobile_device attributes; SIM as an accessory linked to the device.

#### ITAM-048 — Software catalogue and normalization
- **Persian name:** کاتالوگ نرم‌افزار و یکسان‌سازی نام‌ها
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (software models; normalization partial/full/publisher; Content Service), BMC (Normalization Engine: version and suite rollup), Freshservice (normalization and enrichment), ManageEngine SDP (manufacturer merge/unmerge), standards (canonical catalogue keys), ISO/IEC 19770
- **What and how:** A canonical catalogue keyed by publisher, product, version, edition, platform and language with aliases (SWID tagId/regid, CPE, purl). Raw install strings are normalized at three levels (publisher, product, full) by an exact/regex rule library, manual normalization with an override table and custom products; raw values are always kept. Version rollup to market version and suite rollup (suite vs component vs standalone) support licensing; the catalogue includes Iranian publishers and Persian titles. The same keys serve vulnerability matching.
- **Build notes:** `software_product` (publisher → organization, product, version, edition, cpe, purl, swid_tag_id, suite_id) and `software_alias` (raw pattern → product, source); the normalization job runs on install ingestion.

#### ITAM-049 — AI-assisted software normalization
- **Persian name:** یکسان‌سازی هوشمند نام نرم‌افزارها
- **Tier:** P1 · **AI:** yes
- **Sources:** ai research (normalization pipeline), Flexera (Technopedia), ServiceNow (Otto for SAM product match review), standards (AI normalization)
- **What and how:** Unknown strings go through embedding search over the catalogue and an LLM that picks the best candidate with a confidence and a reason; confident matches apply automatically, the rest go to a review queue, and every human decision teaches the alias table. The same pipeline matches products during entitlement import.
- **Build notes:** exact/alias → rules → kNN (k=10) over "publisher | product | edition" embeddings → LLM over the top 5 → JSON {product_id|null, confidence, reason}; auto-map at ≥ 0.95; review items as `ai_proposal`.

#### ITAM-050 — Software installations
- **Persian name:** نصب‌های نرم‌افزار
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (installations from Discovery, SCCM, Intune, Jamf, Tanium, ACC), Freshservice (installations), ManageEngine SDP (software inventory), GLPI, JSM (Data Manager software class)
- **What and how:** Installation records per device: product (raw and normalized), version, path, install date, user and source, de-duplicated across sources; each install links to the device CI and to the entitlement it consumes.
- **Build notes:** `software_install` (ci_id, raw_*, product_id, version, path, installed_at, last_seen, source_id, user_id); upsert by (ci, raw key); marked removed when no source reports it any more.

#### ITAM-051 — Software usage metering
- **Persian name:** سنجش میزان استفاده از نرم‌افزار
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (usage metering, removal candidates), Freshservice (SaaS users first/last used), ManageEngine SDP (usage metering), standards (resource utilization measurement)
- **What and how:** The agent records last-used date, launch count and usage time per installation; installations unused for N days are flagged and feed reclamation and utilization measures.
- **Build notes:** `software_usage` aggregates per (install, month); `last_used_at` on `software_install`.

#### ITAM-052 — Software classification and restricted software
- **Persian name:** طبقه‌بندی نرم‌افزار و نرم‌افزارهای ممنوع
- **Tier:** P1 · **AI:** no
- **Sources:** Freshservice (managed / ignored / restricted), ManageEngine SDP (managed, prohibited, freeware, shareware, excluded; Endpoint Central prohibited-software alerts), ISO/IEC 27001 A.8.19
- **What and how:** Each product has a status: managed, ignored, freeware, shareware, excluded, unidentified, restricted or prohibited. Installs of prohibited software raise an alert or a security incident and can request an approved uninstall through endpoint tools; unexpected and unlicensed installs are reported.
- **Build notes:** `software_product.status`; a rule on install ingestion creates findings or incidents; uninstall through a connector flow with approval.

#### ITAM-053 — Licence entitlements
- **Persian name:** حق‌استفاده‌های لایسنس
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (entitlements, licence metrics, publisher part numbers), Freshservice (licences on software-licence contracts), ManageEngine SDP (licence types incl. subscription, OEM, volume, CAL), BMC (licence certificates), Snipe-IT (seats, reassignable), ISO/IEC 19770-3
- **What and how:** Entitlement records: product, licence metric (per device, per user, named user, concurrent, per core, per processor, PVU, site, enterprise, CAL, subscription seat, OEM, volume, node-locked), quantity, rights, perpetual or subscription term with start and end, maintenance and upgrade entitlements linked to the base licence, contract and PO line, unit cost and currency, company or site scope, reassignable flag and publisher part number; alerts before term end and renewal.
- **Build notes:** `license_entitlement` (number ENT; draft=new → active=active → expired, terminated=closed; canceled) with money fields in field group financial.

#### ITAM-054 — Licence keys vault
- **Persian name:** گاوصندوق کلیدهای لایسنس
- **Tier:** P1 · **AI:** no
- **Sources:** Freshservice (licence key on contracts), Snipe-IT (licence keys), access research (secret fields with reveal audit)
- **What and how:** Licence keys and activation codes are stored encrypted. Revealing one requires the right permission and a reason, is logged, and keys never appear in exports, reports or AI prompts.
- **Build notes:** `secret` field type with a reveal endpoint that writes to the privileged-action log.

#### ITAM-055 — Entitlement import with AI error fixing
- **Persian name:** ورود لایسنس‌ها با رفع خطای هوشمند
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (entitlement import with error results; AI entitlement import error resolution; AI Lens column mapping), ISO/IEC 19770-3 (ENT schema)
- **What and how:** Import entitlements from an Excel template or ISO/IEC 19770-3 ENT files with validation and per-row errors. AI maps columns, suggests fixes for failed rows (unknown product, wrong metric, date formats including Jalali dates) and reviews product matches before commit.
- **Build notes:** Import framework (CMDB-022) with an entitlement mapping; AI suggestions stored as per-row proposals.

#### ITAM-056 — Licence allocation
- **Persian name:** تخصیص لایسنس
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (entitlement allocation), Snipe-IT (seats to users or assets), ManageEngine SDP (allocation and upgrade/downgrade across sites)
- **What and how:** Entitlements are allocated to devices or users (seats), across sites and companies, with history; the unallocated pool is visible; allocation is required for metrics that need it (named user, device-assigned).
- **Build notes:** `license_allocation` (entitlement, target_type, target_id, allocated_at, released_at).

#### ITAM-057 — Product use rights and metric calculators
- **Persian name:** حقوق استفاده و محاسبه‌گرهای معیار لایسنس
- **Tier:** P1 · **AI:** no
- **Sources:** standards (product-use rights: downgrade, virtualization, secondary use, dev/test, multiplexing; versioned rules), ServiceNow (downgrade/upgrade rights; Oracle and IBM core factors), BMC (suite rollup)
- **What and how:** Versioned use-rights rules per publisher, product, licence model and agreement: downgrade and upgrade, virtualization (per VM or per host, core-factor tables), secondary or home use, dev/test, multiplexing and suite or bundle rights. One calculator per metric converts consumption (cores × factor, PVU, named users, concurrent peak). Every compliance snapshot records the rule versions it used.
- **Build notes:** `use_right_rule` (scope, rule json, version, effective dates); calculators are pure, unit-tested functions.

#### ITAM-058 — Effective licence position and compliance
- **Persian name:** وضعیت مؤثر لایسنس و انطباق
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (reconciliation, License Workbench, compliance dashboards), Freshservice (compliant / under / over-licensed), ManageEngine SDP (compliance dashboard), BMC (compliance jobs), ISO/IEC 19770-1, COBIT BAI09.05, analytics (ELP)
- **What and how:** A reconciliation job per product computes entitlements (converted by metric) minus consumption (installs or users after exclusions, rights and bundles): compliant, under-licensed (exposure and true-up cost) or over-licensed (savings). Results are snapshotted per run with history, shown per product in a licence workbench and per publisher in a compliance dashboard; reconciliation grouping and exclusions are supported.
- **Build notes:** `license_reconcile_run` (number LRN) + `license_position` (product, metric, entitled, consumed, delta, exposure, rule_versions); runs nightly and after entitlement or install changes (debounced job).

#### ITAM-059 — True-up and renewal forecasting
- **Persian name:** پیش‌بینی هزینهٔ جبران و تمدید
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (licence change projection), standards (true-up and renewal forecasts), ITIL 4 (renewal management)
- **What and how:** Projects consumption per product from trends, forecasts true-up cost before the contract anniversary and lists upcoming renewals with notice dates and expected cost, feeding the budget.
- **Build notes:** Linear or seasonal projection over `license_position` history; renewal list from entitlement and contract dates.

#### ITAM-060 — Publisher packs
- **Persian name:** بسته‌های ویژهٔ ناشران
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (publisher packs: Microsoft, Oracle, IBM, SAP, Adobe, VMware, Citrix)
- **What and how:** Specialized licensing logic and dashboards for complex publishers: Microsoft (including Microsoft 365), Oracle (database options, processor and core factors), IBM (PVU, sub-capacity), SAP (user classification), Adobe (Creative Cloud), VMware/Broadcom, Citrix and Autodesk, plus packs for the licence models of major Iranian vendors.
- **Build notes:** A pack = use-right rules + calculators + dashboards shipped as versioned content.

#### ITAM-061 — Reclamation and harvesting
- **Persian name:** بازپس‌گیری لایسنس‌های بی‌استفاده
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (removal candidates, reclamation rules, automated uninstall, SaaS reclamation with user notification), Freshservice (SaaS licence reclamation), ManageEngine SDP (unused licence view), COBIT BAI09.04
- **What and how:** Reclamation rules (product, inactivity threshold — 90 days by default with per-publisher overrides —, exclusion groups, notice window) find candidates: unused installs, duplicate installs, inactive SaaS seats and downgrade candidates. Users get a notice with an opt-out window; after approval the install is removed or the seat unassigned through endpoint or SaaS integrations, the licence returns to the pool and savings are recorded; every reclaimed right has an audit trail.
- **Build notes:** `reclamation_rule` + `reclamation_candidate` (number RCL; proposed=new → notified=waiting → approved=active → reclaimed=resolved → closed; opted_out, rejected=canceled).

#### ITAM-062 — AI reclamation and optimization recommendations
- **Persian name:** پیشنهادهای هوشمند بازپس‌گیری و بهینه‌سازی لایسنس
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (reclamation rule creation, Evaluate Software Reclamation agent, unused software reclamation), Flexera (optimization), ai research (rank by savings × confidence)
- **What and how:** Recommends new reclamation rules by spend and utilization, evaluates candidates with safe-removal checks (recent activity in other signals, critical roles), ranks them by savings × confidence and drafts user notices and a summary for the asset manager; execution stays approval-gated.
- **Build notes:** Candidate scoring in code; the LLM writes notices and the summary; outputs are proposals.

#### ITAM-063 — Licence-aware software request fulfilment
- **Persian name:** انجام درخواست نرم‌افزار با بررسی لایسنس
- **Tier:** P1 · **AI:** yes
- **Sources:** standards (software requests checked against ELP; harvest or procure), ServiceNow (software sourcing agentic workflow, Microsoft 365 licence assignment agent, software entitlement allocation)
- **What and how:** A software request checks the licence position first: if a licence is free it is allocated and deployed; if not, harvesting from an inactive user is offered or a requisition is created; the deployment is recorded against the entitlement. An optional agent performs the sourcing and assigns SaaS licences (for example Microsoft 365) through connectors after approval.
- **Build notes:** Catalog flow step "check and allocate licence"; agent tools over licence position, allocations, requisitions and SaaS connectors with autonomy "propose".

#### ITAM-064 — AI contract and invoice entitlement extraction
- **Persian name:** استخراج هوشمند لایسنس از قرارداد و فاکتور
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (contract entitlement extraction via DocIntel), Flexera (AI contract and entitlement ingestion from contracts, invoices, POs, quotes), standards (OCR + LLM with verification), ai research (page-cited fields)
- **What and how:** Upload a contract, invoice, PO or quote (PDF or scan, Persian or English): the system extracts publisher, product, SKU, licence metric, quantity, term, unit cost, currency, true-up terms, territory, use rights and obligations, each with the page and quote it came from, shows them side by side with highlights for verification, normalizes products and creates entitlements linked to the contract. Licence arithmetic stays in code.
- **Build notes:** OCR (Persian-capable) → page segmentation → LLM with a strict JSON schema and `{page, quote}` evidence per field → review UI → entitlements; runs in lane llm on the tenant's model (local model possible). Uses the platform document-extraction service (PLT-066).

#### ITAM-065 — Software spend detection
- **Persian name:** کشف هزینه‌های نرم‌افزاری در تراکنش‌های مالی
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Otto for SAM software spend detection), ai research (classifier + LLM extraction)
- **What and how:** Scans imported financial transactions and payable lines for software purchases, extracts publisher, product and term, matches them to the catalogue and proposes entitlements or flags unknown SaaS (shadow IT).
- **Build notes:** A cheap classifier (TF-IDF + logistic regression on accepted labels) flags lines; the LLM extracts only from flagged lines; proposals are reviewed by the SAM manager.

#### ITAM-066 — Licence compliance insights
- **Persian name:** بینش‌های هوشمند انطباق لایسنس
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (Now Assist for SAM: publisher summaries, product compliance and optimization summaries, recommended actions, publisher compliance insights)
- **What and how:** Summaries per publisher (estate, licence position, risk) and per product (compliance, optimization) with recommended actions to reduce compliance risk or cost, written from deterministic licence-position data and linked to the records.
- **Build notes:** Facts from `license_position` and usage; LLM narration only; cached per reconciliation run.

#### ITAM-067 — Vendor audit defence pack
- **Persian name:** پروندهٔ دفاع در برابر ممیزی ناشر
- **Tier:** P1 · **AI:** no
- **Sources:** standards (audit-defence pack per publisher), ITIL 4 (vendor-audit defence), ISO/IEC 19770-1 (trustworthy data)
- **What and how:** A vendor audit case per publisher holds scope, deadlines, licence-position history, entitlement proofs (contracts, invoices), deployment evidence with discovery timestamps, a communications log, findings and the settlement; the evidence bundle can be exported unchanged.
- **Build notes:** `vendor_audit` (number VAU; notified=new → data_collection=active → awaiting_auditor=waiting → findings=active → settled=resolved → closed); evidence exported as a hashed ZIP.

#### ITAM-068 — SWID/CoSWID and usage-record ingestion
- **Persian name:** دریافت برچسب‌های SWID و سوابق مصرف استاندارد
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC 19770-2 and IETF RFC 9393 (SWID/CoSWID), ISO/IEC 19770-4 (resource utilization measurement)
- **What and how:** Ingests SWID and CoSWID tags (corpus, primary, patch, supplemental; entity roles; evidence and payload; links) for exact software identification, and ISO/IEC 19770-4 utilization records for usage-based licences.
- **Build notes:** Parsers into `software_install.swid_tag_id` and `software_usage`; tag ids mapped to `software_product`.

#### ITAM-069 — SaaS discovery
- **Persian name:** کشف سرویس‌های ابری نرم‌افزاری (SaaS)
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (SaaS License Management: SSO and direct integrations), Freshservice (SaaS Management via IdP and connectors), standards (discovery from SSO logs and expense data), ITIL v5 (shadow AI)
- **What and how:** Finds SaaS applications through identity providers (Entra ID, Okta, Google), direct connectors (Microsoft 365, Google Workspace, Slack, Zoom, Dropbox, Adobe, Salesforce, Box), expense and finance data and agent or browser signals; marks each sanctioned or unsanctioned with an owner and data residency (inside or outside Iran). AI tools found this way feed the AI system inventory.
- **Build notes:** SaaS app as CI class saas_app with an ITAM extension; connectors in the connector framework; unsanctioned apps create review tasks.

#### ITAM-070 — SaaS subscriptions and usage
- **Persian name:** اشتراک‌ها و میزان استفاده از SaaS
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (user subscription profiles, subscription modes, last activity, SaaS overview), Freshservice (usage and spend 360°, renewal reminders), standards (FinOps FOCUS for SaaS)
- **What and how:** Subscription records per app (plan, seats, cost, billing cycle, renewal and notice dates, auto-renew) and per-user accounts (mode, last activity, source); a 360° view of usage and spend, spend per employee and renewal reminders; SaaS apps relate to users, devices and services.
- **Build notes:** `saas_subscription` (number SUB) + `saas_account` (app, user, external id, last_active_at, mode); where vendors bill that way, usage is measured as a 365-day burn-down reset on the contract anniversary.

#### ITAM-071 — SaaS rationalization and shadow-IT insights
- **Persian name:** بینش‌های هوشمند منطقی‌سازی SaaS و فناوری سایه
- **Tier:** P1 · **AI:** yes
- **Sources:** Freshservice (SaaS Insights: redundant and under-utilized apps), ITIL 4 (shadow SaaS anomaly detection), standards (anomaly detection in SaaS usage and spend)
- **What and how:** Flags redundant apps in the same category, under-used apps and seats, unsanctioned apps with data risk and sudden spend changes; AI groups apps by purpose from their descriptions and drafts a rationalization proposal; the risk of a provider becoming unavailable (sanctions, geo-blocking) is shown.
- **Build notes:** Rules over usage and spend + embedding clustering of app descriptions; the LLM drafts the proposal from computed facts.

#### ITAM-072 — SaaS user resolution
- **Persian name:** تطبیق هوشمند حساب‌های SaaS با کارکنان
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (AI user resolution rule creation), ai research (matching cascade)
- **What and how:** Matches SaaS accounts to people: exact email → normalized email (aliases, plus-addressing) → UPN and IdP ids → fuzzy name with domain → LLM tie-break with evidence, never merging on name alone; handles Latin and Persian spellings of names.
- **Build notes:** Matching cascade in code; low-confidence matches become review proposals.

#### ITAM-073 — Asset insights panel
- **Persian name:** پنل بینش‌های هوشمند دارایی
- **Tier:** P1 · **AI:** yes
- **Sources:** JSM (Rovo hardware insights: expiring warranty, low stock, dormant assets, incomplete models, over-assigned, incident-prone), ServiceNow (Generate asset insights)
- **What and how:** Insights from deterministic queries — warranties ending within 30 days, low stock, dormant "ghost" devices not seen for N days, incomplete models, users with too many devices, incident-prone assets, assets without owner or location, overdue audits — phrased and prioritized by AI, with links, filtered by the viewer's permissions; prebuilt prompts.
- **Build notes:** Insight queries as config records; the LLM only phrases; generated on demand and cached per viewer scope.

#### ITAM-074 — Asset analysis summary
- **Persian name:** خلاصهٔ تحلیلی دارایی
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (HAM asset analysis summary)
- **What and how:** A per-asset summary in Persian: lifecycle, assignment and location history, audit status, financials (only if the viewer may see them), missing data and active tasks.
- **Build notes:** Facts assembled in code honouring field groups; the LLM narrates.

#### ITAM-075 — Conversational ITAM setup assistant
- **Persian name:** دستیار گفت‌وگومحور راه‌اندازی مدیریت دارایی
- **Tier:** P2 · **AI:** yes
- **Sources:** JSM (Rovo /hardware-setup and /hardware-configuration), ServiceNow (HAM Configuration Console with AI conversational setup)
- **What and how:** Through chat, the asset manager sets up stock rules, depreciation rules, roles and request-type mappings; the assistant previews every change and asks for confirmation.
- **Build notes:** Agent with config-record tools in propose mode.

#### ITAM-076 — ITAM dashboards and reports
- **Persian name:** داشبوردها و گزارش‌های مدیریت دارایی
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (asset reports), ManageEngine SDP (asset age, executive dashboards, allocation details), JSM HAM (overview dashboards), InvGate (refresh and depreciation dashboard, smart tags), standards (ITAM reports)
- **What and how:** Inventory by class, state, location, model and age; assets without owner or location; warranty and contract expiries; depreciation and book value; refresh due; disposal certificates; stock levels; compliance by publisher; spend and savings; shelfware and utilization; discovery coverage (managed vs unmanaged); allocation per user and department (assets, licences, consumables, cost); executive dashboards; tags such as "flagged for decommission" and "overdue retirement".
- **Build notes:** Shipped reports and dashboards over ITAM tables; financial widgets hidden without the financial field group.

#### ITAM-077 — ITAM access and field security
- **Persian name:** دسترسی و امنیت فیلدهای مدیریت دارایی
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (granular ITAM roles, restricted asset read), Freshservice (Contract Manager, Procurement Manager), GLPI (financial information rights), BMC (company-scoped asset financial records), ManageEngine SDP (site-scoped assets), access research
- **What and how:** Roles: asset manager, HAM admin, SAM admin, procurement manager, stockroom manager, asset auditor, requester. Cost, price, depreciation and contract values are masked unless the user holds the financial field group — also in exports, reports and AI prompts. Stockroom managers get location-subtree scope; site and company scoping apply; requesters see only their own assets; purchases above a threshold require requester ≠ approver ≠ receiver.
- **Build notes:** Scope profile on `asset`: own = [assigned_to, managed_by], group = managed_by_group_id, unit = unit_id, location_subtree = location or stockroom location, cost_center_subtree = cost_center_id, company/domain; field group financial on money fields; segregation of duties as dynamic approval rules.

#### ITAM-078 — ITAM management system and SAMP
- **Persian name:** نظام مدیریت دارایی و برنامهٔ راهبردی آن
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC 19770-1:2017 (+ Amd 1:2024), ISO/IEC TS 19770-10:2025, ISO 55001:2024 (SAMP), ITIL 4 (common approach to ITAM)
- **What and how:** Templates and records for the ITAM management system: scope (asset types and organizational scope), policy, objectives, plan, risks, roles and competence, documented information, internal audits and management reviews; a strategic asset management plan with per-class plans and decision criteria (lifecycle cost, risk, performance, sustainability).
- **Build notes:** Document templates in the knowledge module + review records with schedules; links to KPIs.

#### ITAM-079 — Sustainability attributes and e-waste reporting
- **Persian name:** ویژگی‌های پایداری و گزارش پسماند الکترونیکی
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC TS 20000-16:2025, ISO/IEC 19770-1 Amd 1:2024 (climate action), ITIL 4 sustainability extension
- **What and how:** Energy rating and draw, embodied carbon, refurbished or reused status and e-waste route per asset; carbon per user, service and site, and reports for sustainability objectives.
- **Build notes:** Attributes on models and assets; aggregates feed the financial module's sustainability accounting.

### Data model

| Table | Prefix | Purpose and key fields | States (category) | Access anchors |
|---|---|---|---|---|
| `asset` | AST | class (hardware/consumable/accessory/component/mobile/peripheral/non_it), model_id, ci_id (1:1, nullable), asset_tag, serial_number, state, substate, assigned_to, assigned_at, usage_type (permanent/loaner), managed_by, managed_by_group_id, unit_id, location_id, stockroom_id, cost_center_id, company_id, parent_asset_id, qty (quantity items), PO line, vendor_id, cost, currency, purchase_date, invoice_ref, warranty_start/end, warranty_provider, depreciation_rule_id, salvage, book_value (derived), received_at, deployed_at, retired_at, disposed_at, disposal_method, certificate, encrypted, mdm_enrolled, acknowledgement_status, last_audit_at, next_audit_at, last_audit_result, failure_risk, epc, imei, hamta_status, sustainability attrs | in_stock (new); on_order, in_transit, in_repair, missing, to_be_returned (waiting); preparing, in_use, on_loan (active); pending_disposal (resolved); retired, consumed (closed); canceled | own: assigned_to, managed_by · group: managed_by_group_id · unit: unit_id · location_subtree: location_id / stockroom location · cost_center_subtree: cost_center_id · company/domain · field group **financial** on money fields |
| `model` | MDL | kind (hardware/software/consumable/facility), manufacturer_id, model_number, sku, category_id, specs, release/eol/eos dates, lifecycle_source, warranty_months, status (approved/under_review/exception/deprecated/prohibited), procurement_mode, depreciation_rule_id, useful_life | active/deprecated/retired | read: all agents; write: asset managers |
| `model_category`, `model_vendor_price`, `model_alias`, `hardware_standard` | — | category → ci_class + asset class; vendor, price, currency, warranty, lead time, valid_from; raw string → model; persona, models, accessories, software, refresh_months | config | prices in field group financial |
| `stockroom`, `stock_rule`, `stock_movement`, `stock_level` | — | type, location_id, manager_id, parent_id; model, stockroom, min, max, order_qty; immutable movement ledger (kind, qty, reason, task); materialized levels | — | location_subtree on the stockroom location |
| `transfer_order` (+ lines) | TRO | from/to stockroom or user, carrier, tracking, lines | draft (new); shipped (waiting); partially_received (active); received (resolved); closed; canceled | location anchors of both stockrooms |
| `asset_checkout` | — | item_type, item_id, qty, target_type (user/unit/location/asset), target_id, out_at, expected_in_at, in_at, condition, acceptance_id, task_id | open/closed | as asset; own for the target user |
| `asset_acceptance` | ACK | user, assets, template, channel, signature, pdf | pending (waiting); accepted (closed); declined (resolved); expired (canceled) | own: user · asset managers |
| `asset_reservation`, `kit`, `kit_item`, `catalog_item_model` | — | loaner bookings (from, to); kits; catalogue item → model preference | reservation: requested/active/returned | own: requester |
| `purchase_requisition` (+ lines) | PRQ | requester, cost_center_id, budget_line, lines (model, qty, est. cost) | draft (new); pending_approval (waiting); approved (active); ordered (resolved); closed; rejected/canceled | own: requester · unit · cost_center_subtree · procurement group |
| `purchase_order` (+ lines) | PO | vendor_id, currency, rate, expected_delivery, addresses, lines (model, qty ordered/received, unit cost, tax, discount, GL code, cost centre), totals, terms | open (new); pending_approval (waiting); ordered, partially_received (active); received (resolved); closed; cancelled (canceled) | group: procurement · cost_center_subtree · financial field group |
| `goods_receipt` (+ lines), `asn` | GRN | PO, receiver, lines with serials/tags | draft (new); completed (closed) | procurement / stockroom |
| `label_template` | — | layout, code type, size, fields | config | asset managers |
| `inventory_audit` (+ items) | AUD | scope (location/stockroom/class/cost centre), expected set, auditor, method (scan/rfid/self); item result found/missing/moved/unexpected/wrong_state | planned (new); in_progress, reconciling (active); completed (resolved); closed; canceled | location_subtree · auditors (participant) |
| `repair_order` | RMA | asset, route (internal/external/vendor), rma_no, vendor ticket, cost, loaner | new; diagnosing, in_repair (active); awaiting_vendor, awaiting_parts (waiting); repaired, beyond_repair (resolved); closed; canceled | group: repair team · own: requester |
| `refresh_campaign` | RFR | candidate query, waves, budget | planned (new); running (active); completed (resolved); closed | asset managers |
| `disposal_order` (+ items) | DSP | method, vendor, items with sanitization method/tool/operator/date/verification, certificate, chain of custody, resale value | requested (new); approved, sanitizing (active); awaiting_certificate (waiting); disposed (resolved); closed; canceled | asset managers · security officers (read) |
| `depreciation_rule`, `asset_value_snapshot` | — | method, life or rate, salvage %, start; monthly book value per asset | config / facts | financial field group |
| `maintenance_plan`, `asset_ci_sync_rule` | — | interval, checklist; field-level master for asset↔CI sync | config | asset managers |
| `software_product`, `software_alias` | — | publisher_id, product, version, edition, platform, language, cpe, purl, swid_tag_id, suite_id, status (managed/ignored/freeware/…/prohibited) | — | read: all agents |
| `software_install`, `software_usage` | — | ci_id, raw publisher/product/version, product_id, path, installed_at, last_seen, last_used_at, source_id, user_id; monthly usage | — | as device CI |
| `license_entitlement` | ENT | product_id, metric, quantity, rights, term_start/end, perpetual, base_entitlement_id, contract_id, po_line_id, unit_cost, currency, scope (company/site), reassignable, part_number, license_key (secret) | draft (new); active (active); expired, terminated (closed); canceled | group: SAM team · company/domain · financial + secret fields |
| `license_allocation`, `use_right_rule` | — | entitlement, target, from/to; versioned rights rules | — | SAM team |
| `license_reconcile_run`, `license_position` | LRN | run time, rule versions; product, metric, entitled, consumed, delta, exposure | run: queued/running/completed | SAM team; aggregates for managers |
| `reclamation_rule`, `reclamation_candidate` | RCL | product, inactivity days, exclusions, notice window; candidate user/device, savings, decision | proposed (new); notified (waiting); approved (active); reclaimed (resolved); closed; opted_out/rejected (canceled) | own: affected user (notice) · SAM team |
| `vendor_audit` | VAU | publisher, scope, deadlines, evidence bundle, findings, settlement | notified (new); data_collection, findings (active); awaiting_auditor (waiting); settled (resolved); closed | SAM team · legal (participant) |
| `saas_subscription`, `saas_account` | SUB | app CI (class saas_app), plan, seats, cost, cycle, renewal/notice dates, auto_renew; account user, external id, last_active_at, mode | subscription: active/expired/cancelled | SAM team · app owner · financial fields |

**Relationships:** `asset.model_id → model`; `asset.ci_id ↔ ci`; `asset_checkout.target → user/unit/location/asset`; `purchase_requisition → purchase_order → goods_receipt → asset`; `purchase_order.vendor_id → organization`; `contract_coverage(asset/entitlement) → contract` (supplier); `license_entitlement → software_product`, `→ contract`, `→ purchase_order_line`; `software_install → ci`, `→ software_product`, consumed by `license_position`; `catalog_item_model → catalog_item` (request module); `inventory_audit_item → asset`; `cost_entry.asset_id → asset` (financial).

**Access scoping:** asset anchors are **live** (assignment, stockroom and cost centre follow the asset). Requesters: `own` (assigned_to); managers: `reportees`/`unit_subtree`; stockroom managers: `location_subtree` anchored on their stockroom; SAM team: `group`; budget owners: `cost_center_subtree` with financial fields; auditors: `participant` on audit sessions. Money fields are field group `financial`, licence keys are `secret`.

### KPIs

| KPI | Formula | Notes |
|---|---|---|
| Register (inventory) accuracy | records matching physical or agent audit ÷ records sampled | Target ≥ 95–98% |
| Ownership completeness | assets with owner and location ÷ assets | |
| Audit discrepancy rate | (missing + moved + unexpected) ÷ expected items | Per audit and location |
| Overdue audits | assets with next_audit_at < today ÷ auditable assets | |
| Effective licence position | Σ entitlements (converted by metric) − Σ consumption, per product | Positive = surplus, negative = shortfall |
| Compliance exposure | Σ max(0, consumption − entitlement) × unit price | In base currency |
| Licence utilization | licences used (active in last N days) ÷ licences purchased | N = 30 or 90 |
| Shelfware | assigned but unused ≥ 90 days ÷ assigned | |
| Harvest savings | Σ reclaimed licences × annual unit cost | Recorded in the savings register |
| SaaS spend per employee | SaaS spend ÷ headcount | Monthly |
| Out-of-warranty share | production assets past warranty end ÷ production assets | Also past EOS / EOL |
| Refresh compliance | devices replaced at policy age ÷ devices due | |
| Stock-out rate | stock-rule breaches ÷ stock rules, per period | Plus days of stock = on hand ÷ average daily issue |
| Provisioning time | avg(deployed_at − requested_at) | Also % new hires equipped on day one |
| Leaver recovery | leaver assets returned within N days ÷ leaver assets | |
| Lost/stolen rate | assets lost or stolen per year ÷ assets in use | |
| Disposal with certificate | disposed assets with sanitization certificate ÷ disposed assets | Target 100% |
| Certified e-waste share | assets disposed via certified recycler ÷ disposed assets | |
| Acknowledgement completion | accepted acknowledgements ÷ required acknowledgements | |
| Normalization coverage | installs mapped to the catalogue ÷ installs | |
| Discovery coverage (managed vs unmanaged) | devices reporting via agent/discovery ÷ devices in register | |
| TCO per user/device/service | acquisition + operation + disposal − residual, per unit | Lifecycle view |
| True-up exposure forecast | projected shortfall at anniversary × unit price | |

### Beyond the market

- **Iranian procurement reality.** Official Persian PO, waybill and receipt PDFs; supplier national ID and economic code; VAT; Rial/Toman; several exchange rates for imported hardware; price-adjustment clauses — global tools handle none of these.
- **Local warranty and grey-market imports.** Warranty provider recorded separately from the manufacturer (local warranty companies), product authenticity checks and Hamta IMEI registration status for mobile devices.
- **Tax and management depreciation side by side.** Iranian tax depreciation tables next to management depreciation, plus inflation-adjusted replacement cost of the fleet (FIN-042).
- **Sanctions-aware SAM.** Flags licences and SaaS that may be cut off by sanctions or geo-blocking, records data residency (inside/outside Iran), shows compliance exposure from unlicensed copies honestly and suggests local alternatives in the catalogue.
- **Offline stocktaking.** The Windows app with a USB barcode scanner (or a phone) runs audits in warehouses without network and syncs later; labels print with correctly shaped Persian text.
- **Acknowledgements and reminders on local channels.** OTP signatures via Iranian SMS gateways and reminders through Bale/Eitaa bots instead of email-only flows that many employees ignore.
- **Persian document AI on a local model.** Contracts, pro-forma invoices and official invoices in Persian (often scanned) are read by AI with page citations, on the tenant's own model so financial documents never leave the organization.
- **Jalali-native planning.** Audit cycles, warranty and lease dates, refresh waves and the Esfand year-end budget rush planned in Jalali months with Iranian holidays.

## Module: service_portfolio — سبد و کاتالوگ خدمات

### Features

#### SPF-001 — Service record and service types
- **Persian name:** رکورد خدمت و انواع خدمت
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (service catalogue management; service/product record), ISO/IEC 20000-1 §8.2.4, FitSM PR1–PR2, ServiceNow (CSDM business and technical services), JSM (services), BMC (business service CIs), ManageEngine SDP (services as CIs), Freshservice (service CIs)
- **What and how:** Every service has: id, name, consumer-language description, value proposition and intended outcomes, type (customer-facing/business, supporting/technical, enabling), service owner, product owner, provider organization, consumers (customers and user groups), lifecycle stage, tier and criticality, service hours, support channels, offerings, commitments, supporting services and CIs, suppliers, cost model and price reference, risks, continuity tier, security classification, documentation links, the ITIL v5 digital-spectrum class (analogue, digitally supported, digitally enabled, purely digital) and a sustainability profile. Services are CIs, so impact analysis and the catalogue share one identity.
- **Build notes:** `service` (number SVC) = portfolio extension 1:1 with a CI of class business_service/technical_service (`ci_id`); the CI holds graph data, `service` holds portfolio fields; field group financial on cost fields.

#### SPF-002 — Service lifecycle and portfolio stages
- **Persian name:** چرخهٔ عمر خدمت و بخش‌های سبد خدمات
- **Tier:** P0 · **AI:** no
- **Sources:** ISO/IEC 20000-1 §8.2.4 and §8.5, FitSM PR1.3, ITIL 4 (pipeline / catalogue / retired), ServiceNow (SPM lifecycle; DPM lifecycle stages), BMC
- **What and how:** Lifecycle Proposed → Approved (chartered) → In design → In transition → Live → Deprecated (closed to new subscribers) → Retired, grouped into the pipeline, catalogue and retired views of the portfolio. The stage drives catalogue visibility (only Live offerings are orderable), change rules (new service, removal or transfer counts as a major change that needs design and transition) and notifications to subscribers when a service is deprecated.
- **Build notes:** `service.state` (proposed=new; approved, design, transition, live, deprecated=active; retired=closed; rejected=canceled) with transition guards (Live needs owner, at least one offering and commitments); catalogue and change rules read it.

#### SPF-003 — Portfolio taxonomy
- **Persian name:** طبقه‌بندی سبد خدمات
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (SPM taxonomy portfolio → category → service → offering), ManageEngine SDP (IT and Business groups, up to five category levels), iTop (service families), ITIL 4
- **What and how:** A tree of portfolio nodes (portfolio → category, up to five levels → service → offering) with an owner per node; top groups such as IT services and business services; used for navigation, reporting roll-ups, catalogue structure and score roll-ups.
- **Build notes:** `portfolio_node` tree (parent_id, owner, kind) with materialized path; `service.portfolio_node_id`.

#### SPF-004 — Service offerings
- **Persian name:** بسته‌های خدمت (Offering)
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (service_offering with commitments, support and approval groups, schedule, price), ITIL 4 (offerings per segment with utility and warranty), IT4IT (Service Offer), BMC (offerings with price and service-level targets), Xurrent (offerings with targets, charges, effort classes)
- **What and how:** Orderable or consumable variants of a service per segment, level (gold/silver/bronze), region or size, each with its own commitments, support hours, support and approval groups, schedule, price reference, entitlement rule (who may consume it), SLA template, and utility and warranty specifications. Incidents, requests, changes and SLAs reference the offering, so cost, risk and performance roll up per offering.
- **Build notes:** `service_offering` (number OFR; service_id, level, region, calendar_id, support_group_id, approval_group_id, price_list_item_id, entitlement Cond, sla_template refs; draft=new → active → deprecated → retired=closed).

#### SPF-005 — Service commitments library
- **Persian name:** کتابخانهٔ تعهدهای خدمت
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (service commitments: availability, response/resolution SLAs, support hours), ITIL 4 (utility and warranty specifications), ISO/IEC 20000-1 (service levels)
- **What and how:** Reusable commitments — availability %, response and resolution targets per priority, support hours and channels — attached to offerings; they generate or link the SLA definitions in service-level management, are versioned and effective-dated so history is not rewritten.
- **Build notes:** `service_commitment` (kind availability|response|resolution|support_hours, target, calendar_id, version, valid_from); generates `sla_definition` rows (owned by SLM) with a back-reference.

#### SPF-006 — Service instances and environments
- **Persian name:** نمونه‌های خدمت و محیط‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** Xurrent (service instances linked by "supported by"), ServiceNow (CSDM application services / service instances), iTop, ITIL 4
- **What and how:** A logical service has deployed instances (for example "Email – production – Tehran DC", "Email – DR"), each with its CIs (an application service or dynamic group), support team, environment and the SLAs that cover it; "supported by" links between instances form a hierarchy that can span providers.
- **Build notes:** `service_instance` (service_id, environment, region, ci_group_id or app_service_ci_id, support_group_id); the SLA applicable to a request = requester organization × service instance × covering offering.

#### SPF-007 — Service tiers and criticality
- **Persian name:** سطح اهمیت و حیاتی‌بودن خدمت
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (service tiers 1–4 driving automation and approvals), ServiceNow (business criticality), ITIL 4 (criticality/tier), EU DORA (critical or important functions)
- **What and how:** Tier 1 (failure significantly affects customers or revenue) to Tier 4 (no significant effect), with tenant-editable meanings. Tiers drive automation (notify a group when a Tier 1 service is affected), change approvals and risk, notification urgency and continuity requirements; they do not set incident priority automatically.
- **Build notes:** Choice field on `service` and `service_offering`; copied into the CI criticality used by impact and critical-function propagation (CMDB-065).

#### SPF-008 — Service roles in context
- **Persian name:** نقش‌های وابسته به خدمت
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (owner team, responders, change approvers, stakeholders), ServiceNow (service owner, support/approval groups), FitSM (service owner, customer relationship manager), access research (service owner is a role-in-context)
- **What and how:** Each service names its owner, owner team, product owner, responders, change approvers, stakeholder groups and relationship manager. These are roles in context: the service owner of X can read all records linked to X and approve changes affecting X, without a global role.
- **Build notes:** Role-context grants `service_owner(service=X)`; records linked to a service carry `st:` access keys (service scope); stakeholder groups used as notification audiences.

#### SPF-009 — Service model and supporting services
- **Persian name:** مدل خدمت و خدمات پشتیبان
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (service model), ServiceNow (CSDM layers), IT4IT (conceptual → logical → release blueprint → desired topology → actual), BMC (service models), ISO/IEC 20000-1 (services are CIs)
- **What and how:** The chain business service → offerings → technical/application services → CIs, with traceability from the conceptual design to the deployed CIs; the service page shows this model as a layered dependency map (from the CMDB) together with the suppliers and contracts behind each layer.
- **Build notes:** Relationships in `ci_rel` between service CIs and technical CIs; layered map rendered by the CMDB graph widget; supplier links via `contract_coverage`.

#### SPF-010 — Affected services on records
- **Persian name:** خدمات متأثر در رکوردها
- **Tier:** P0 · **AI:** no
- **Sources:** JSM (affected services on incidents, changes, problems, alerts; approver source), ServiceNow (business service and offering on tasks), BMC (service CI field; impacted services), ManageEngine SDP (Services Affected), Freshservice (impacted services)
- **What and how:** Incidents, problems, changes, releases and alerts carry affected services, derived automatically from the CI through the service closure and editable. They show upstream and downstream dependencies, carry over from alert to incident, add service owners as change approvers, notify stakeholder groups, trigger tier-based automation and feed risk insights (recent incidents and failed changes on the same service).
- **Build notes:** Multi-ref field `affected_services` on task tables filled by a hook from `ci_service_closure`; approval rules with source "service owners of affected services".

#### SPF-011 — Request catalogue linked to offerings
- **Persian name:** پیوند کاتالوگ درخواست با بسته‌های خدمت
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (catalog items linked to offerings), ITIL 4 (request catalogue is a view of the service catalogue), BMC (requestable offerings, DWP catalog), ManageEngine SDP (service templates as orderable offerings), iTop
- **What and how:** Catalogue items belong to offerings, so the portal shows each service with what can be requested from it; the offering's entitlement rule filters the items a requester sees; prices and approvals come from the offering unless the item overrides them.
- **Build notes:** `catalog_item.offering_id`; portal query joins offering entitlement conditions evaluated at display and again at submit.

#### SPF-012 — Audience-specific catalogue views
- **Persian name:** نماهای کاتالوگ برای مخاطبان مختلف
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (user, customer and technical views; view definition with approval), ISO/IEC 20000-1 (one or more catalogues), BMC (sub-catalogs)
- **What and how:** View definitions (audience, filter, field set, layout, channel: portal, PDF, API) project the same service data for different readers: a user view (what I can order), a customer view (service levels, prices, outcomes) and a technical view (supporting services and CIs). Views are projections, not copies; requests for new views go through approval.
- **Build notes:** `catalog_view` (audience Cond, filter, fields[], layout, channel, approved_by); rendered via `readWhere` + field projection.

#### SPF-013 — Service subscriptions
- **Persian name:** اشتراک در خدمات
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (service subscriptions in Employee Center), access research (services as audiences), Xurrent
- **What and how:** Users, groups, units, locations or companies subscribe to offerings (manually or by rule, e.g. everyone in unit X). Subscribers see "my services", receive status and outage messages and planned-change notices, and form the audience for service-specific knowledge and AI answers.
- **Build notes:** `service_subscription` (subscriber_type, subscriber_id, offering_id, from, to, origin rule|manual); notification rules use it as a recipient source.

#### SPF-014 — Service entitlement by agreement
- **Persian name:** استحقاق خدمت بر پایهٔ توافق‌نامه
- **Tier:** P1 · **AI:** no
- **Sources:** iTop (customer contracts link organizations to services and SLAs), ServiceNow (CSM entitlements), access research (contract-based service entitlement)
- **What and how:** Customer agreements link organizations (internal units or external customers) to the offerings and service levels they are entitled to; the portal offers only covered services, and an entitlement snapshot is stored on each request so later disputes use the terms in force at the time.
- **Build notes:** `service_agreement` link table (customer org, offering, sla refs, valid dates); snapshot json on the request.

#### SPF-015 — Service performance score and health roll-up
- **Persian name:** امتیاز عملکرد خدمت و تجمیع سلامت
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (SPM offering performance score; DPM health roll-ups), BMC (service health), ITIL 4 (service KPIs)
- **What and how:** A daily score per offering combines weighted availability attainment, SLA attainment, incidents and problems normalized by user count, open high-risk changes and satisfaction (CSAT/XLA, user ratings); it rolls up to services and taxonomy nodes, has thresholds and alerts and shows the live health from alerts and outages.
- **Build notes:** Daily job writes `service_score_fact(date, offering, components json, score)`; weights configurable; roll-up by portfolio path.

#### SPF-016 — Service owner workspace and scorecard
- **Persian name:** میز کار و کارنامهٔ مالک خدمت
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Service Owner Workspace, Digital Portfolio Management workspace), JSM (Compass scorecards), BMC
- **What and how:** Per service: KPIs (cost if permitted, incidents, SLA, satisfaction, changes, risks, demand), health, roadmap, linked SLAs/OLAs/UCs, open problems, upcoming changes, suppliers and solution cards for its applications and instances, plus planning views (ideas, demands, projects).
- **Build notes:** Special page of generic widgets scoped by `service_owner(service=X)`; financial widgets need the financial field group.

#### SPF-017 — Service proposals and demand intake
- **Persian name:** پیشنهاد خدمت جدید و دریافت تقاضا
- **Tier:** P1 · **AI:** no
- **Sources:** FitSM-1 PR1.2, ISO/IEC 20000-1 §8.2.2, ITIL 4 (portfolio management), IT4IT (Evaluate)
- **What and how:** Proposals for new or changed services capture predicted demand, required resources, expected benefits, risks and impact on existing services and the management system; they are scored, prioritized against business needs and approved; approval charters the service (stage Approved) and links the business case and the project that will build it.
- **Build notes:** `service_proposal` (number SPR; draft=new → submitted=waiting → evaluation=active → approved=resolved → chartered=closed; rejected, withdrawn=canceled); scoring model as config.

#### SPF-018 — Service design and transition package
- **Persian name:** بستهٔ طراحی و انتقال خدمت
- **Tier:** P1 · **AI:** no
- **Sources:** FitSM-4 (service design and transition package template), ISO/IEC 20000-1 §8.5.2, ITIL 4 (service design: requirements, readiness, handover)
- **What and how:** For each new service or major change: functional and non-functional requirements (availability, capacity, security, continuity, sustainability, compliance), design specifications, acceptance criteria, an operational-readiness checklist, plans and acceptance results, with design reviews and approvals and a handover to release and change.
- **Build notes:** `service_design_package` (number SDT; draft=new → in_review=waiting → approved=active → accepted=resolved → closed; canceled) with checklist items and links to releases and changes.

#### SPF-019 — Service design artefacts and canvas
- **Persian name:** ابزارهای طراحی خدمت و بوم خدمت
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (personas, journey maps, service blueprints, design thinking), VeriSM (Define stage, service blueprint), USM (Service Model Canvas)
- **What and how:** Personas, journey maps, service blueprints and a one-page Service Model Canvas (customer, value proposition, facilities and support, agreements, delivery teams) attached to proposals and services, with templates.
- **Build notes:** `design_artifact` (kind, content markdown/json, linked record); canvas as a structured form.

#### SPF-020 — Service rationalization analytics
- **Persian name:** تحلیل منطقی‌سازی سبد خدمات
- **Tier:** P1 · **AI:** no
- **Sources:** standards (rationalization scorecards: cost, utilization, satisfaction, risk, technical health, strategic fit; TBM views), ITIL 4 (cost vs value quadrants, overlap detection), IT4IT (Evaluate)
- **What and how:** Portfolio scorecards per service (cost per service, utilization, satisfaction, risk, technical health, strategic fit) shown on cost-versus-value quadrants, with overlap detection and lists of retirement or consolidation candidates exportable to TBM views.
- **Build notes:** Aggregates over `service_score_fact`, financial allocations and assessments; quadrant chart widget.

#### SPF-021 — AI duplicate and overlapping service detection
- **Persian name:** کشف هوشمند خدمات تکراری و هم‌پوشان
- **Tier:** P2 · **AI:** yes
- **Sources:** ITIL 4 (duplicate/overlapping service detection), standards (AI detection from descriptions and usage)
- **What and how:** Finds services or offerings that overlap, from their descriptions (embeddings) and from shared users, CIs and request patterns, and presents candidate pairs with evidence for portfolio review.
- **Build notes:** Nightly embedding similarity + usage overlap scoring; LLM writes the comparison; results as review proposals.

#### SPF-022 — AI service and catalogue description writer
- **Persian name:** نگارش هوشمند شرح خدمت و کاتالوگ
- **Tier:** P1 · **AI:** yes
- **Sources:** ITIL 4 (service descriptions in consumer language), standards (plain-language drafting with readability and accessibility checks), BMC (Catalog Curator), ServiceNow (catalog item generation)
- **What and how:** Drafts consumer-language Persian descriptions, value statements and FAQs from technical data, or scaffolds a whole service with offerings from a short brief; checks readability and accessibility, translates between Persian and English and keeps a human approval step.
- **Build notes:** Skill with inputs from the service record (no task text sent); output as a proposal on the record; readability score computed in code.

#### SPF-023 — AI catalogue gap and portfolio insights
- **Persian name:** بینش هوشمند شکاف کاتالوگ و سبد خدمات
- **Tier:** P1 · **AI:** yes
- **Sources:** BMC (Service Optimizer, Catalog Service Sensor), ServiceNow (LEAP grouping of automation opportunities), ai research (portfolio insights recipe)
- **What and how:** Each quarter, requests and incidents are clustered per service to find demand with no catalogue item (a gap), items almost nobody uses (retirement candidates) and services with a high incident-to-request ratio; the AI drafts a portfolio review memo that cites the clusters.
- **Build notes:** Clustering job over embeddings of request/incident text (stays inside the tenant); counts computed in code; LLM writes the memo with citations.

#### SPF-024 — AI service and offering classification on records
- **Persian name:** تشخیص هوشمند خدمت و بستهٔ خدمت در تیکت‌ها
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (triage agent sets service, offering and CI), BMC (intelligent service prediction), JSM (service-based AI routing roadmap), ai research (service classifier)
- **What and how:** Suggests the service, offering and CI on new tickets from the text, the caller's department and location and the CI; abstains below a confidence threshold, is retrained monthly and reports precision per service so owners can trust it.
- **Build notes:** Nearest neighbours over embeddings with a logistic-regression head; label = service on resolved records; suggestions shown as AI-filled fields.

#### SPF-025 — Demand management and forecasting
- **Persian name:** مدیریت و پیش‌بینی تقاضای خدمات
- **Tier:** P1 · **AI:** yes
- **Sources:** ISO/IEC 20000-1 §8.4.2, ITIL v5 (demand prediction in Discover), standards (demand forecasting from ticket and usage history)
- **What and how:** Current and forecast demand per service at planned intervals, from subscriptions, usage records and ticket volumes; forecasts include Iranian calendar effects (Nowruz, Ramadan, fiscal year-end) and prediction intervals and feed capacity and budget planning.
- **Build notes:** Statistical forecast (seasonal decomposition with Jalali calendar regressors) in code; LLM explains drivers; `demand_forecast` (service, period, forecast, low, high, actual).

#### SPF-026 — Business relationship management
- **Persian name:** مدیریت ارتباط با کسب‌وکار
- **Tier:** P1 · **AI:** no
- **Sources:** ISO/IEC 20000-1 §8.3.2, FitSM PR7 (customer relationship manager), COBIT APO08, ITIL 4 (relationship types basic/cooperative/partnership)
- **What and how:** A register of customers (internal business units and external customers) with a relationship manager, communication channels (ordering, escalation, complaints), expectations and opportunities log, relationship type, satisfaction and periodic customer reviews with minutes, actions and agreement changes.
- **Build notes:** `customer_relationship` (customer org, manager, type, channels) and `customer_review` (number CRV; scheduled=new → held=active → actions_open=waiting → closed).

#### SPF-027 — Application portfolio management
- **Persian name:** مدیریت سبد برنامه‌های کاربردی
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (APM: business applications, assessments, indicators, TIME), ITIL 4 (application portfolio TIME), CSDM (business application)
- **What and how:** Inventory of business applications with owner, IT owner, user count, lifecycle, cost (TCO from the financial module), hosting, vendor, technology stack, criticality and data classification; questionnaire-based assessments and indicators (business value, technical fit, cost, risk, user satisfaction); a TIME disposition (tolerate, invest, migrate, eliminate) and retirement planning.
- **Build notes:** CI class business_application + `app_assessment` (number ASM; draft=new → sent=waiting → completed=resolved → closed) using the shared questionnaire engine (PLT-061); quadrant views.

#### SPF-028 — Technology portfolio and lifecycle risk
- **Persian name:** سبد فناوری و ریسک چرخهٔ عمر
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (TPM: technology lifecycle, standards approved/retiring/prohibited, risk roll-up), ITIL 4 (technology lifecycle EOL/EOS), EU DORA (yearly legacy ICT risk assessment)
- **What and how:** Technology components (software and hardware product versions) with vendor support, extended support and end-of-life dates from the catalogue, and technology standards (approved, retiring, prohibited, exception). Risk rolls up to the applications and services that run on outdated technology, and a yearly legacy-system review creates tasks for owners.
- **Build notes:** `technology_standard` (product ref, status, valid dates); roll-up via CMDB relationships from software instances to applications; review tasks by scheduled flow.

#### SPF-029 — Business capability map
- **Persian name:** نقشهٔ قابلیت‌های کسب‌وکار
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (EA workspace, CSDM business capabilities), ITIL 4 (business-capability map), TOGAF-style practice
- **What and how:** A capability hierarchy (levels 1–3) mapped to applications and services, shown as heat maps by cost, health, TIME disposition and redundancy to reveal gaps and overlaps.
- **Build notes:** `business_capability` tree + `capability_link` (capability, application or service, coverage); heat-map widget.

#### SPF-030 — Enterprise architecture repository
- **Persian name:** مخزن معماری سازمانی
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (architecture management: principles, standards, technology radar, ADRs, reference architectures), ServiceNow (EA workspace)
- **What and how:** Principles and standards, reference architectures, architecture decision records, a technology radar (adopt, trial, assess, hold), information objects and target-state roadmaps, linked to CIs and projects.
- **Build notes:** `architecture_decision` (number ADR), `tech_radar_entry`, documents in the knowledge module with typed links.

#### SPF-031 — Architecture review board workflow
- **Persian name:** گردش کار هیئت بازبینی معماری
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (architecture review board), ITIL v5 (architecture board role)
- **What and how:** Projects and changes submit designs to the architecture board; reviews check standards and principles; decisions (approved, approved with conditions, rejected) and time-limited exceptions are recorded; compliance is reported.
- **Build notes:** `arb_review` (number ARB; submitted=new → in_review=active → awaiting_info=waiting → decided=resolved → closed; withdrawn=canceled).

#### SPF-032 — Strategy cascade and OKRs
- **Persian name:** آبشار راهبرد و اهداف کلیدی
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (strategy management; DITS), ITIL v5 (VUCA strategy, PESTLE), COBIT APO02
- **What and how:** Vision, goals, objectives and key results, strategic themes, initiatives and SWOT/PESTLE analyses, cascaded to portfolios, services and KPIs, with an alignment heat map (shared with the project/portfolio module).
- **Build notes:** `strategic_objective` (number OBJ) with key results and links; alignment computed from links.

#### SPF-033 — Service and application roadmaps
- **Persian name:** نقشهٔ راه خدمات و برنامه‌ها
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (DPM planning views: roadmaps, dependencies, backlogs, ideas, demands, projects), ITIL 4 (roadmap view)
- **What and how:** A timeline per service or application with planned releases, changes and projects, contract renewals, deprecation and retirement dates and dependencies between items, in Jalali months.
- **Build notes:** Timeline widget over linked records' dates; no new storage beyond links.

#### SPF-034 — Digital products and versioned offers
- **Persian name:** محصولات دیجیتال نسخه‌دار
- **Tier:** P2 · **AI:** no
- **Sources:** IT4IT 3.0 (Digital Product, Service Offer; Evaluate and Explore value streams), VeriSM (Define stage), ITIL v5 (product versions in several lifecycle stages)
- **What and how:** Digital products as the portfolio unit with product backlog, product releases and service offers; each product version has its own lifecycle stage (one version live while another is in design).
- **Build notes:** `service` with kind product + `product_version` (version, stage); offers link to versions.

#### SPF-035 — Service registry for engineering
- **Persian name:** ثبت خدمات برای تیم‌های مهندسی
- **Tier:** P2 · **AI:** no
- **Sources:** JSM (Service ID used by CI/CD deployment tracking, linked repositories), Compass (components)
- **What and how:** Each technical service gets a Service ID used by CI/CD pipelines to report deployments, linked code repositories (GitHub, GitLab, Bitbucket, Azure DevOps) and the list of recent deployments on the service page (with the devops module).
- **Build notes:** `service.service_key` unique; deployment events posted by API create change records via the devops module.

#### SPF-036 — Service import from observability tools
- **Persian name:** ورود خدمات از ابزارهای پایش
- **Tier:** P2 · **AI:** no
- **Sources:** JSM (Teamwork Graph connectors: Datadog, Dynatrace, New Relic), BMC (AIOps service blueprints)
- **What and how:** Imports services and service-to-service relationships from observability tools (Datadog, Dynatrace, New Relic, Zabbix, Prometheus) into technical services with a default tier, namespaces to keep instances apart, daily sync with soft deletion and an import log.
- **Build notes:** Connector writing through the reconciliation engine, upsert by (namespace, external_id).

#### SPF-037 — Two-way sync with component catalogues
- **Persian name:** همگام‌سازی دوطرفه با کاتالوگ اجزای نرم‌افزاری
- **Tier:** P2 · **AI:** no
- **Sources:** JSM (Compass synchronization), Backstage (developer component catalogue)
- **What and how:** Two-way sync with external developer catalogues (Backstage, Compass): field-level ownership decides which fields sync in which direction, deletions become tombstones instead of cascading, and each side keeps its own permissions.
- **Build notes:** Sync connector with per-field direction map and tombstone records; conflict log.

#### SPF-038 — Multi-provider catalogue integration
- **Persian name:** یکپارچه‌سازی کاتالوگ چند تأمین‌کننده
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (integrate catalogues of multiple providers; SIAM), BMC (third-party catalogs such as AWS Service Catalog), SIAM BoK
- **What and how:** Catalogue entries from several providers (internal units, outsourcers, cloud catalogues) are brought into one catalogue with provider ownership, mapping to local offerings and integration-health checks per source.
- **Build notes:** `catalog_source` with sync adapter; entries keep `provider_org_id` and external ids.

#### SPF-039 — Catalogue health checks and periodic review
- **Persian name:** پایش سلامت کاتالوگ و بازبینی دوره‌ای
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (catalogue completeness, accuracy, integration health), ISO/IEC 20000-1 (catalogue maintained), FitSM PR2
- **What and how:** Checks the share of services with owner, commitments, outcomes and description, flags entries not reviewed for N months, broken links between offerings and catalogue items and failing source integrations, and sends annual review tasks to owners.
- **Build notes:** Rules as config + scheduled flow creating review tasks; health widget.

#### SPF-040 — Multilingual catalogue content
- **Persian name:** محتوای چندزبانهٔ کاتالوگ
- **Tier:** P1 · **AI:** yes
- **Sources:** ITIL 4 (catalogue publishing with multilingual content), ServiceNow (localized catalog), analytics (Persian language services)
- **What and how:** Names, descriptions and outcomes of services, offerings and items in Persian and English (more languages optional), shown in the reader's language, with AI-drafted translations reviewed by a person.
- **Build notes:** Translatable fields stored as `{fa, en}` json; drafts come from the platform translation service (PLT-078) as proposals.

#### SPF-041 — Portfolio reports and boards
- **Persian name:** گزارش‌ها و تابلوهای سبد خدمات
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (portfolio views), BMC (pipeline/catalogue/retired views), ServiceNow (SPM views)
- **What and how:** Kanban boards by lifecycle stage (pipeline, catalogue, retired), lists by owner, tier and category, cost per service (if permitted), linked SLAs and KPIs, time to market and Persian PDF export of the catalogue.
- **Build notes:** Kanban view on `service.state`; shipped reports; PDF rendering with Persian fonts.

#### SPF-042 — AI service health narrative
- **Persian name:** روایت هوشمند سلامت خدمت
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Service Observability dashboard summarization), BMC (service health)
- **What and how:** A short narrative of a service's health for its owner or the status page, built from alerts, incidents, changes and SLA data of the period.
- **Build notes:** Facts from aggregates; LLM narration; the status-page variant uses only public facts.

#### SPF-043 — Catalogue API and MCP exposure
- **Persian name:** ارائهٔ کاتالوگ از طریق API و MCP
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (catalogue API exposure), ai research (headless ITSM via MCP)
- **What and how:** A read API exposes catalogue views to other systems (intranet, chatbots, external agents through MCP), applying the caller's audience entitlements.
- **Build notes:** Read-only endpoints over `catalog_view`; MCP tool definitions generated from the same views.

### Data model

| Table | Prefix | Purpose and key fields | States (category) | Access anchors |
|---|---|---|---|---|
| `service` | SVC | 1:1 portfolio extension of a CI of class business_service / technical_service (`ci_id`): service_type (business/technical/enabling), portfolio_node_id, description_fa/en, value_proposition, outcomes, owner_id, owner_group_id, product_owner_id, relationship_manager_id, provider_org_id, tier, criticality, calendar_id (service hours), channels, security_classification, continuity_tier, digital_spectrum, sustainability profile, cost model ref, service_key (CI/CD) | proposed (new); approved, design, transition, live, deprecated (active); retired (closed); rejected (canceled) | own: owner_id, product_owner_id · group: owner_group_id · service: `st:` (role-in-context service_owner) · company/domain: provider org · workspace |
| `service_offering` | OFR | service_id, name, level (gold/silver/bronze…), region, calendar_id, support_group_id, approval_group_id, price_list_item_id, entitlement condition, sla templates, utility/warranty specs | draft (new); active; deprecated (active); retired (closed) | as service; entitlement condition defines who may consume |
| `service_commitment` | — | kind (availability/response/resolution/support_hours), target, priority, calendar_id, version, valid_from → generates `sla_definition` (SLM) | config | service owners |
| `service_instance` | — | service_id, environment, region, ci_group_id or app_service_ci_id, support_group_id | active/retired | group: support_group_id · as service |
| `portfolio_node` | — | parent_id, kind (portfolio/category), owner, path | config | read: all; write: portfolio managers |
| `catalog_view` | — | audience condition, filter, fields, layout, channel, approved_by | config | audience-based |
| `service_subscription` | — | subscriber_type (user/group/unit/location/company), subscriber_id, offering_id, from, to, origin | active/ended | own: subscriber · service owners |
| `service_agreement` | — | customer org, offering, SLA refs, valid dates | active/expired | company: customer org · service owners |
| `service_score_fact` | — | date, offering_id, components (json), score | — | service owners; aggregate for managers |
| `service_proposal` | SPR | proposer, predicted demand, resources, benefits, risks, score, business_case_id, project_id | draft (new); submitted (waiting); evaluation (active); approved (resolved); chartered (closed); rejected/withdrawn (canceled) | own: proposer · group: portfolio board |
| `service_design_package` | SDT | service_id, requirements, specs, acceptance criteria, readiness checklist, linked releases/changes | draft (new); in_review (waiting); approved (active); accepted (resolved); closed; canceled | service owner · design team (group) |
| `design_artifact` | — | kind (persona/journey/blueprint/canvas), content, linked record | — | as linked record |
| `customer_relationship`, `customer_review` | CRV (review) | customer org, manager, relationship type, channels, expectations; review minutes, actions | review: scheduled (new); held (active); actions_open (waiting); closed | own: relationship manager · company: customer org |
| `app_assessment` (business_application is a CI class) | ASM | application CI, questionnaire, scores (value, fit, cost, risk, satisfaction), TIME disposition | draft (new); sent (waiting); completed (resolved); closed | application owner · EA team |
| `technology_standard` | — | product ref, status (approved/retiring/prohibited/exception), valid dates | config | EA team |
| `business_capability`, `capability_link` | — | capability tree (level 1–3); capability ↔ application/service with coverage | config | read: all agents |
| `architecture_decision`, `tech_radar_entry`, `arb_review` | ADR / — / ARB | decision context and consequences; ring (adopt/trial/assess/hold); submission, decision, conditions, exception expiry | ARB: submitted (new); in_review (active); awaiting_info (waiting); decided (resolved); closed; withdrawn (canceled) | EA team · submitter (own) |
| `strategic_objective` | OBJ | objective, key results, owner, period, links (shared with project module) | draft/active/achieved/closed | owners; read all |
| `product_version`, `demand_forecast`, `catalog_source` | — | product version stage; service, period, forecast, low, high, actual; external catalogue sources | — | service owners |

**Relationships:** `service.ci_id → ci` (services are CIs; dependencies live in `ci_rel`); `service_offering.service_id → service`; `catalog_item.offering_id → service_offering` (request module); `service_commitment → sla_definition` (SLM); `service_instance → ci_group` (CMDB); task tables carry `service_id`, `offering_id`, `affected_services`; `service_proposal → business_case` (financial) and `→ project` (project module); `contract_coverage → service` (supplier); `allocation_result → service/offering` (financial).

**Access scoping:** the service is itself an anchor: records linked to a service carry `st:` keys so a service owner role pinned to service X reads them without a global role. Catalogue visibility uses audiences (subscriptions, agreements, entitlement conditions) evaluated at display and again at submit.

### KPIs

| KPI | Formula | Notes |
|---|---|---|
| Portfolio completeness | services with owner, commitments and defined outcomes ÷ live services | |
| Catalogue accuracy | audited entries correct ÷ audited entries | |
| Catalogue coverage | demand clusters with a catalogue item ÷ demand clusters | From SPF-023 |
| Catalogue usage | portal views and orders per offering per period | Retire candidates below a floor |
| Time to market | avg(live_at − approved_at) | Per service type |
| First-time readiness | design packages accepted at first review ÷ packages reviewed | |
| Offering performance score | Σ wᵢ·componentᵢ (availability, SLA attainment, normalized incidents, risky changes, CSAT) | Daily, rolled up |
| Availability attainment | achieved availability ÷ committed availability, per offering | |
| Incident-to-request ratio | incidents ÷ requests per service | High = quality problem |
| Rationalization savings | Σ annual cost of retired/consolidated services − transition cost | |
| Architecture compliance | projects approved by ARB without exceptions ÷ projects reviewed | |
| Supported-technology share | applications on supported technology versions ÷ applications | |
| OKR attainment | average key-result score | |
| Demand forecast accuracy | 1 − abs(forecast − actual) ÷ actual | Per service |
| Service classification precision | correct AI service suggestions ÷ accepted + corrected suggestions | Per service |
| Customer satisfaction per service | average CSAT / XLA score of the service's records | |

### Beyond the market

- **Plain-language Persian catalogue.** AI drafts consumer-language Persian descriptions with a Persian readability score and formal/informal tone control; no leading tool has Persian-aware writing help.
- **Iranian demand patterns.** Demand forecasts model Nowruz, Ramadan and Muharram holidays, the Esfand fiscal year-end rush and the start of the academic year (Mehr).
- **Holding-company portfolios.** Many Iranian enterprises are holdings with a shared IT service centre: one portfolio, offerings and entitlements per subsidiary, linked to internal chargeback.
- **Government-style service identity cards.** The service record can be exported as the service identity card (شناسنامهٔ خدمت) format that Iranian public bodies use, alongside the ITIL fields.
- **Status and subscriptions on local channels.** Subscribers receive outage and change notices by SMS and Bale/Eitaa/Telegram, with a localized status page.
- **Persian ticket intelligence.** Catalogue-gap clustering and service classification are tuned for Persian text (ZWNJ, character variants, colloquial forms).
- **Offline catalogue.** The Windows app keeps the user's catalogue view offline and queues orders until the connection returns.
- **Service ownership without licence friction.** Service owners are roles in context with exact access to their service's records — no extra seats or cloned roles.

## Module: supplier — تأمین‌کنندگان و قراردادها

### Features

#### SUP-001 — Supplier register
- **Persian name:** دفتر تأمین‌کنندگان
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (supplier record), ISO/IEC 20000-1 §8.3.4.1, FitSM PR8, COBIT APO10.01, ServiceNow (core_company vendor flag), JSM (External organizations: roles, vendor code, partnership status), Freshservice (vendors), BMC and ManageEngine SDP (vendor records)
- **What and how:** One shared organization directory with type flags (vendor, manufacturer, reseller, service provider, internal supplier, customer, partner). Supplier data: legal name, national ID and economic code (Iran), registration number, LEI/EUID where relevant, country, addresses, website and support portal, vendor code, category, services and products supplied, supported services and CIs, relationship owner, account manager at the supplier, partnership status (active, preferred, on probation, blacklisted), criticality, risk tier, lifecycle status, certifications and documents.
- **Build notes:** `organization` (number ORG) with type flags and a supplier section; manufacturer and vendor references from models, assets, contracts and POs point here; sensitive fields (bank details, risk) in field groups financial/security.

#### SUP-002 — Supplier contacts and escalation matrix
- **Persian name:** مخاطبان تأمین‌کننده و ماتریس تشدید
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (contacts and escalation matrix), FitSM PR8.1, ISO/IEC 20000-1 §8.3.4.1, ServiceNow (vendor contacts), ManageEngine SDP
- **What and how:** Contacts per supplier with role (account manager, support desk, technical lead, legal, billing), escalation level and hours, channels (phone, email, messenger) and, when needed, a link to an external user account whose access ends with the contract.
- **Build notes:** `supplier_contact` (org, person data in field group personal, role, escalation_level, channels, user_id, access_until).

#### SUP-003 — Supplier segmentation and criticality
- **Persian name:** دسته‌بندی و حیاتی‌بودن تأمین‌کنندگان
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (strategic / tactical / operational / commodity; basic / cooperative / partnership), NIST CSF GV.SC-04, EU DORA (critical or important functions), standards (critical-function flags from the graph)
- **What and how:** Suppliers are segmented (strategic, tactical, operational, commodity) and given a relationship type (basic, cooperative, partnership). Criticality is derived from the services and CIs they support (critical-function flags propagated in the CMDB) and from spend, and is shown on a segmentation matrix; critical suppliers get stricter checklists, assessments and exit plans.
- **Build notes:** Computed `organization.criticality` from `contract_coverage` + `ci.supports_critical_function` + spend; manual override with reason.

#### SUP-004 — Supplier lifecycle, onboarding and offboarding
- **Persian name:** چرخهٔ عمر تأمین‌کننده، ورود و خروج
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (supplier journey: identify → engage → evaluate and select → contract → onboard/offboard → monitor → review), SIAM BoK (onboarding and offboarding checklists), ServiceNow (TPRM offboarding)
- **What and how:** Lifecycle prospective → due diligence → onboarding → active → under review → exiting → inactive. Onboarding and offboarding checklists cover documents, NDA, security review, access provisioning and bank details; offboarding revokes access, returns or deletes data and closes open obligations.
- **Build notes:** `organization.supplier_state` (prospective=new; due_diligence, onboarding, active, exiting=active; under_review, suspended=waiting; inactive=closed; rejected=canceled); checklists as task templates.

#### SUP-005 — Contract register
- **Persian name:** دفتر قراردادها
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (contract record), ISO/IEC 20000-1 §8.3.4, ServiceNow (ast_contract), Freshservice (contracts: lease, maintenance, software licence, warranty, custom types), BMC, ManageEngine SDP (contracts), ISO/IEC 27001 A.5.20
- **What and how:** One contract table for all types: underpinning contract, MSA, SOW, maintenance, support, warranty, lease, software licence, subscription, cloud service, NDA and DPA, plus custom types with their own fields. Fields: number, title, type, parties (supplier and internal owning unit), owner and contract manager, start and end dates, notice period, renewal type (automatic, manual, none), value, currency, billing cycle (one-time, monthly, quarterly, half-yearly, annual), payment schedule, cost centre, documents and visibility (restricted contracts for legal or HR).
- **Build notes:** `contract` (number CNT) with money fields in field group financial and a `restricted` flag for confidential contracts; custom types via custom fields.

#### SUP-006 — Contract lifecycle and approval
- **Persian name:** چرخهٔ عمر و تصویب قرارداد
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (Draft → Pending approval → Approved/Rejected → Active → Expired/Terminated, approver with delegation), ServiceNow (contract approvals), ManageEngine SDP (drafts, cancellation), ITIL 4
- **What and how:** Draft → negotiation → pending approval → approved → active → expired, terminated or superseded; approval by contract value bands through the authority matrix with delegation; termination records the reason and date; "expiring" is shown as a flag before the end date.
- **Build notes:** `contract.state` (draft=new; negotiation, approved, active=active; pending_approval=waiting; expired, terminated, superseded=closed; rejected, canceled=canceled); approvals via the shared engine.

#### SUP-007 — Contract lines, rate cards and price terms
- **Persian name:** اقلام قرارداد، نرخ‌نامه و شرایط قیمت
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (item cost details: per-unit or fixed), ServiceNow (rate cards, contract lines), Halo (charge rates per labour type), ITIL 4 (value and payment schedule)
- **What and how:** Line items (item, quantity, per-unit or fixed price, period), rate cards (hourly rates per role, unit prices per service), discounts, taxes (VAT), and price-adjustment clauses linked to an index (for example the official price-adjustment indices used in Iranian contracts); totals and remaining value are computed.
- **Build notes:** `contract_line` (contract, item, qty, unit_price, period, tax, covered refs) + `rate_card` (role or unit, rate, currency, valid dates); adjustment index table shared with the financial module.

#### SUP-008 — Contract coverage links
- **Persian name:** پیوند قرارداد با دارایی‌ها، CIها و خدمات
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (associated assets and software), ManageEngine SDP (associations to assets, licences, POs), ServiceNow (covered assets), BMC (create contract from an asset)
- **What and how:** A contract lists what it covers: assets, CIs, software entitlements, services, locations and purchase orders. Assets, CIs and services show their contracts; incidents and changes see coverage (warranty, maintenance, support hours of the supplier); a contract can be created directly from an asset or another contract.
- **Build notes:** `contract_coverage` (contract, target_type, target_id, from, to, coverage level); related lists on asset, CI and service pages.

#### SUP-009 — Renewal, notice and expiry management
- **Persian name:** مدیریت تمدید، مهلت اعلام و انقضا
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (expiry notifications, renewal creates linked contract), ManageEngine SDP (notifications up to 3,650 days ahead, renewal under same name, auto-renewal), BMC (renewal), ITIL 4 (renewal and notice alerts)
- **What and how:** Reminders before the notice deadline and before the end date go to chosen people (owner, contract manager, budget owner) through email, in-app, SMS or messenger; auto-renewal is tracked; renewing creates a linked successor contract and keeps the renewal history; a renewals calendar shows upcoming decisions in Jalali months.
- **Build notes:** Notification rules on `notice_date = end_date − notice_period`; `contract.previous_contract_id`; renewal action clones lines into a draft; holiday shifting uses the platform business calendars (PLT-053).

#### SUP-010 — Contract hierarchy, amendments and documents
- **Persian name:** سلسله‌مراتب قرارداد، الحاقیه‌ها و اسناد
- **Tier:** P1 · **AI:** no
- **Sources:** ManageEngine SDP (parent contracts, conversations, usage tracking), ServiceNow (MSA and contract lines), BMC (create from another contract)
- **What and how:** Master agreements with child SOWs or call-offs; amendments as effective-dated versions of terms; documents with versions and signatures; internal conversation on the contract; consumption tracking against contract value or hours.
- **Build notes:** `contract.parent_id`; `contract_amendment` (effective_from, changes json, document); consumption from linked cost entries and time entries.

#### SUP-011 — Contract obligations tracking
- **Persian name:** پیگیری تعهدات قرارداد
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Contract Management Pro obligations and commitments), ITIL 4 (obligations), ISO/IEC 20000-1 (contractual obligations)
- **What and how:** Obligations of either party (deliverables, reports, audits, insurance, security tests, data return) with owner, due date or recurrence and status; reminders before due dates; breaches are flagged and can trigger credits or disputes.
- **Build notes:** `contract_obligation` (number OBL; open=new → in_progress=active → waiting_counterparty=waiting → fulfilled=resolved → closed; breached=resolved with flag; waived=canceled); recurrence via the schedule service.

#### SUP-012 — Guarantees, bonds and retention
- **Persian name:** ضمانت‌نامه‌ها و سپرده‌های حسن انجام کار
- **Tier:** P1 · **AI:** no
- **Sources:** local practice (bank guarantees and retention in Iranian contracts), ITIL 4 (credits and penalties), standards (contract value)
- **What and how:** Bank guarantees and bonds per contract (bid, performance, advance payment, warranty) with bank, amount, issue and expiry dates and extension requests; retention money held and released by milestone; alerts before guarantees expire.
- **Build notes:** `contract_guarantee` (number GUA; type, bank, amount, currency, expiry, state active → extension_requested=waiting → released=closed, forfeited=resolved).

#### SUP-013 — AI contract summary and obligation extraction
- **Persian name:** خلاصه و استخراج هوشمند تعهدات قرارداد
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (manage contract repository agentic workflow: metadata and obligations, reviewer accepts or rejects), Flexera (contract ingestion), ITIL 4 (contract summarization), standards (clause extraction)
- **What and how:** From a signed contract (Persian or English, scanned or digital), AI extracts metadata (parties, dates, value, notice period, renewal terms), service levels, penalties and obligations, each cited to page and quote; a reviewer accepts or rejects every extracted item before it becomes data; a plain-language summary is produced.
- **Build notes:** Platform document-extraction pipeline (PLT-066: OCR → segmentation → LLM with JSON schema and evidence) → review UI → `contract` fields and `contract_obligation` rows.

#### SUP-014 — AI contract clause gap check
- **Persian name:** بررسی هوشمند کمبود بندهای قرارداد
- **Tier:** P2 · **AI:** yes
- **Sources:** standards (clause gap check against EU DORA Art. 30, GDPR Art. 28 and internal templates), ISO/IEC 27001 A.5.20
- **What and how:** Compares a contract with the required-clause checklist for its type and criticality (security, data location, audit rights, subcontracting, exit, data return) and with the organization's templates, listing missing or weak clauses with citations.
- **Build notes:** Retrieval of the checklist rubric + LLM labels each requirement met / partial / missing with quotes; results stored on the checklist (SUP-032).

#### SUP-015 — Underpinning contracts and supplier SLAs
- **Persian name:** قراردادهای پشتیبان و SLA تأمین‌کننده
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (UC timers), ServiceNow (SLA definitions of type underpinning contract with vendor), BMC (UCs in SLM), Freshservice (vendor contracts as underpinning contracts), ISO/IEC 20000-1 §8.3.4
- **What and how:** Supplier targets from contracts become UC timers on tasks: they start when a task is assigned to the supplier or enters "awaiting supplier" and stop when the supplier responds or resolves; attainment is reported per supplier and contract and feeds scorecards and credits.
- **Build notes:** `sla_definition` (type uc, contract_id, supplier condition) owned by the SLM engine; UC instances on the same task as the customer SLA.

#### SUP-016 — Supplier fields and supplier-pending states on tasks
- **Persian name:** فیلدهای تأمین‌کننده و وضعیت «در انتظار تأمین‌کننده» در تیکت‌ها
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (Vendor field, Awaiting Vendor), BMC (vendor ticket number, Supplier Delivery / Third Party Vendor Action Required pending reasons), Freshservice (Awaiting vendor pauses SLA)
- **What and how:** Tasks carry supplier, supplier ticket number, supplier contact and the contract used; the "awaiting supplier" pending reason pauses the customer SLA while the UC timer runs; reports show time spent waiting on each supplier.
- **Build notes:** Task fields `vendor_id`, `vendor_ticket`, `vendor_contact_id`, `contract_id`; pending reason choice with SLA pause condition.

#### SUP-017 — Supplier groups as external assignees
- **Persian name:** گروه‌های تأمین‌کننده به‌عنوان مسئول تیکت
- **Tier:** P1 · **AI:** no
- **Sources:** BMC (vendor assignee groups in row-level security), ServiceNow (vendor contacts as external users), ITIL 4 (supplier groups as assignees), access research (external agent persona)
- **What and how:** Supplier support groups can be assigned tasks. Their members are external users who see only records assigned to their group, cannot browse the directory, see only notes marked "shared with supplier" and lose access when the contract ends.
- **Build notes:** Group type supplier with `organization_id`; persona external with scopes assigned + group only; journal visibility `shared_with_vendor`; access end date from the contract.

#### SUP-018 — Supplier portal
- **Persian name:** پرتال تأمین‌کنندگان
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (TPRM vendor portal: questionnaires, documents, issues; e-signature), ServiceNow (Source-to-Pay supplier portal, supplier data updates), ITIL 4 (supplier portal with restricted access)
- **What and how:** A portal for supplier users: tasks assigned to them, questionnaires, document uploads (certificates, insurance, invoices), risk issues and remediation, purchase-order acknowledgements and updates to their own company data with validation, plus e-signature of acknowledgements.
- **Build notes:** Portal pages over supplier-scoped tables with persona external; uploads via attachments; data updates as change proposals reviewed internally.

#### SUP-019 — E-bonding and ticket brokering
- **Persian name:** اتصال دوسویهٔ تیکت با سامانهٔ تأمین‌کننده
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Vendor eBonding spoke), BMC (multi-vendor ticket brokering), ITIL 4 (e-bonding with defined interfaces), SIAM BoK (data exchange rules), Halo (tool-to-tool e-bonding)
- **What and how:** Bi-directional exchange of tickets with suppliers' service desks (ServiceNow, JSM, Freshservice, generic REST/webhook or email): state, comments and attachments stay in sync under a mapping with field ownership, loop prevention and correlation ids; brokering rules route tasks to the right supplier; the exchange is monitored with retries.
- **Build notes:** `ebond_connection` (endpoint, mapping, field ownership, auth secret) + `ebond_message` log; outbound via jobs lane external; inbound webhook with signature check.

#### SUP-020 — Supplier performance scorecards
- **Persian name:** کارنامهٔ عملکرد تأمین‌کنندگان
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (performance scorecards), ISO/IEC 20000-1 §8.3.4.1, FitSM PR8.4, COBIT APO10.05, BMC (vendor scorecards from UC compliance and cycle times), ai research (deterministic scorecard)
- **What and how:** Weighted scorecards per supplier and period: UC attainment, incidents caused by supplier CIs, on-time delivery (PO expected vs received), quality and rework, responsiveness, invoice accuracy, satisfaction and XLA, innovation; templates per segment; trends and comparison between suppliers.
- **Build notes:** `scorecard_template` (metrics, weights) + `supplier_scorecard` facts computed by a monthly job from SLA, task, PO and invoice data.

#### SUP-021 — Supplier reviews and improvement plans
- **Persian name:** جلسه‌های بازبینی و برنامهٔ بهبود تأمین‌کننده
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (periodic supplier reviews, improvement plans), ISO/IEC 20000-1 (reviews at planned intervals), COBIT APO10.05
- **What and how:** Scheduled supplier reviews with agenda built from the scorecard, minutes, decisions and actions with owners and due dates; improvement plans tracked to completion.
- **Build notes:** `supplier_review` (number QBR; scheduled=new → held=active → actions_open=waiting → closed) with action tasks.

#### SUP-022 — AI supplier performance narrative
- **Persian name:** روایت هوشمند عملکرد تأمین‌کننده
- **Tier:** P2 · **AI:** yes
- **Sources:** ai research (supplier scorecard narrative; market gap), ITIL 4 (supplier performance insights)
- **What and how:** Writes the quarterly business review narrative for a supplier — trends, wins, problems, recommended actions — only from the computed scorecard numbers and linked records.
- **Build notes:** Facts JSON from `supplier_scorecard` and linked incidents; LLM narration with citations.

#### SUP-023 — Supplier service credits and penalties
- **Persian name:** جریمه‌ها و اعتبارهای خدمتی تأمین‌کننده
- **Tier:** P1 · **AI:** no
- **Sources:** standards (service credits per breach tier and caps; dispute workflow; credits passed to invoicing), ITIL 4 (credits/penalties in contracts)
- **What and how:** Credit rules per contract (amount or percent per breach tier, caps per period) compute the credits due from UC breaches; a claim workflow (raise → evidence → supplier response → decision) settles them and passes accepted credits to invoice matching in the financial module.
- **Build notes:** `supplier_credit_claim` (number SCC; draft=new → submitted=waiting → accepted, rejected=resolved → settled=closed; canceled) with computed amount from UC instances.

#### SUP-024 — Contract disputes
- **Persian name:** اختلافات قراردادی
- **Tier:** P1 · **AI:** no
- **Sources:** ISO/IEC 20000-1 §8.3.4.1 (disputes recorded, managed and formally closed), ITIL 4 (disputes), SIAM BoK (cross-provider dispute paths)
- **What and how:** Disputes with suppliers are recorded with subject, amount, evidence and owner, worked through negotiation and escalation steps and formally closed with the decision; ageing of open disputes is reported.
- **Build notes:** `supplier_dispute` (number DIS; raised=new → under_review=active → awaiting_supplier=waiting → decided=resolved → closed; withdrawn=canceled).

#### SUP-025 — Third-party risk: due diligence and assessments
- **Persian name:** ریسک شخص ثالث: ارزیابی پیش از قرارداد و دوره‌ای
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (TPRM: inherent risk questionnaire, tiering, SIG and custom assessments, reassessment schedules), COBIT APO10.02/10.04, NIST CSF GV.SC-06/07, ISO/IEC 27001 A.5.19–5.21, ISO/IEC 27036, EU DORA Art. 28(4)
- **What and how:** An inherent-risk questionnaire with weighted scoring and knock-out questions sets the risk tier; the tier selects the external questionnaire set (SIG, CSA CAIQ, custom, Iranian ISMS/AFTA checklists) and the reassessment frequency. Assessments go to suppliers through the portal, support Excel import/export, evidence review and approval, and create risks in the shared risk register.
- **Build notes:** `supplier_assessment` (number SAS; draft=new → sent=waiting → in_review=active → completed=resolved → closed; canceled) on the shared questionnaire engine (PLT-061); scoring in code; risks via the security/risk module.

#### SUP-026 — Supplier risk issues and remediation
- **Persian name:** مسائل ریسک تأمین‌کننده و اصلاح آن‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (TPRM issues and remediation tasks), NIST CSF GV.SC-07, COBIT APO10.04
- **What and how:** Issues raised from assessments or findings get remediation tasks for the supplier with due dates, acceptance or time-limited exceptions and tracking to closure.
- **Build notes:** `supplier_risk_issue` (number SRI; new → analyze=active → remediation=active → awaiting_supplier=waiting → review=active → closed; risk_accepted=resolved).

#### SUP-027 — AI for third-party risk assessments
- **Persian name:** هوش مصنوعی در ارزیابی ریسک تأمین‌کنندگان
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (Now Assist for TPRM: issue summarization, issue recommendation from responses, response generation), ai research (questionnaire analysis recipe)
- **What and how:** Labels each questionnaire answer as meets, partial, gap or needs evidence against the control expectation, citing the answer; proposes issues that require a person's confirmation; summarizes issues at every state; drafts our own answers when customers send us questionnaires.
- **Build notes:** Rubric retrieval + LLM classification with citations; outputs are proposals; evidence documents go through the document-extraction pipeline.

#### SUP-028 — Continuous supplier risk monitoring
- **Persian name:** پایش پیوستهٔ ریسک تأمین‌کنندگان
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (external risk ratings: SecurityScorecard, BitSight), standards (risk-signal monitoring: breach news, sanctions, financial distress), NIST CSF GV.SC-07
- **What and how:** External risk ratings and news, breach, sanctions and financial-distress signals are collected per supplier, summarized by AI and can trigger reassessment; for foreign providers the risk of sanctions or geo-blocking is tracked.
- **Build notes:** Connectors for rating services and news feeds; AI summary per signal; threshold rules create review tasks.

#### SUP-029 — Supplier certifications and compliance documents
- **Persian name:** گواهی‌نامه‌ها و مدارک انطباق تأمین‌کنندگان
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (certifications ISO 27001, SOC 2, ISO 14001), standards (certificate expiry, SOC 2 period and bridge letters), NIST CSF GV.SC-05
- **What and how:** Certificates and documents per supplier — ISO/IEC 27001 (scope and expiry), SOC 2 report period and bridge letters, ISO 9001, 14001, 20000, product security certificates (AFTA), informatics company rating, guild licence, insurance — with verification status and expiry alerts.
- **Build notes:** `supplier_certification` (org, type, number, issuer, scope, valid_from, valid_to, document, verified_by).

#### SUP-030 — Fourth parties and sub-processors
- **Persian name:** پیمانکاران دست دوم و پردازشگران فرعی
- **Tier:** P2 · **AI:** no
- **Sources:** standards (sub-contractors, fourth parties, sub-processor change notification), EU DORA (sub-contracting chain), GDPR Art. 28
- **What and how:** The subcontracting chain of each supplier (fourth parties and sub-processors) with the services they perform, data they touch and location; change notifications and approvals.
- **Build notes:** `supplier_subcontractor` (supplier, subcontractor org, services, data, location, approved).

#### SUP-031 — Concentration and substitutability analysis
- **Persian name:** تحلیل تمرکز و جایگزین‌پذیری تأمین‌کنندگان
- **Tier:** P2 · **AI:** no
- **Sources:** EU DORA Art. 29 (concentration risk), standards (concentration by provider and by critical function; substitutability)
- **What and how:** Shows dependency concentration by supplier and by critical function (spend and number of critical services per supplier) and records a substitutability rating and alternatives for each critical supplier.
- **Build notes:** Aggregates over contracts, coverage and critical-function flags; fields on `organization` for substitutability.

#### SUP-032 — Contract requirement checklists
- **Persian name:** چک‌لیست الزامات قرارداد
- **Tier:** P1 · **AI:** no
- **Sources:** ISO/IEC 27001 A.5.20, EU DORA Art. 30, ISO/IEC 20000-1 §8.3.4.1, NIST CSF GV.SC-05, GDPR Art. 28
- **What and how:** Templates of mandatory clauses by contract type and criticality: security requirements, data location, audit and access rights, subcontracting, incident assistance, service levels, termination and exit, data return; completing the checklist gates contract approval, and critical-function contracts get the stricter set.
- **Build notes:** `contract_clause_check` (contract, requirement, status met|partial|missing|n/a, evidence quote); template chosen by rule.

#### SUP-033 — Exit plans
- **Persian name:** برنامه‌های خروج
- **Tier:** P1 · **AI:** no
- **Sources:** EU DORA Art. 28(8), NIST CSF GV.SC-10, ITIL 4 (exit plans), ISO/IEC 27001 A.5.23 (cloud exit)
- **What and how:** An exit plan per critical supplier or contract: triggers, transition period, data return and deletion, substitute providers, knowledge transfer and post-relationship duties, with dated tests of the plan.
- **Build notes:** `exit_plan` (number EXIT; draft=new → approved=active → tested=active → invoked=active → closed).

#### SUP-034 — Suppliers in incident and continuity planning
- **Persian name:** تأمین‌کنندگان در برنامه‌ریزی حادثه و تداوم
- **Tier:** P2 · **AI:** no
- **Sources:** NIST CSF GV.SC-08, ISO 22301, ITIL 4
- **What and how:** Supplier contacts and escalation paths appear in major-incident communication plans; supplier continuity plans and test evidence are kept; recovery dependencies on suppliers are visible in business impact analyses.
- **Build notes:** Links from continuity plans and major-incident templates to `organization` and `supplier_contact`; document records.

#### SUP-035 — Cloud service governance
- **Persian name:** حاکمیت خدمات ابری
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC 27001 A.5.23, ITIL 4 (Acquiring and Managing Cloud Services)
- **What and how:** For each cloud service: shared-responsibility matrix, portability and exit plan, provider certifications and data residency (inside or outside Iran).
- **Build notes:** Contract type cloud with a responsibility matrix sub-table and residency field.

#### SUP-036 — Data processing agreements
- **Persian name:** قراردادهای پردازش داده
- **Tier:** P2 · **AI:** no
- **Sources:** GDPR Art. 28/30/44–49, ISO/IEC 27701
- **What and how:** A data processing agreement per processor, sub-processor lists, links to processing records, and transfer mechanisms with impact assessments; applies the Iranian personal-data framework once enacted.
- **Build notes:** `dpa_record` linked to contract and supplier; processing records owned by the privacy part of the security module.

#### SUP-037 — EU DORA register of information
- **Persian name:** دفتر اطلاعات قراردادهای فناوری طبق DORA
- **Tier:** P2 · **AI:** no
- **Sources:** EU DORA Art. 28(3), EU Implementing Regulation 2024/2956 (15 templates, xBRL-CSV)
- **What and how:** Generates the register of information from supplier, contract, ICT service, function and CI data instead of a separate spreadsheet, validates identifiers (LEI/EUID), dates and links, exports xBRL-CSV and keeps each submitted package immutable with its receipt; the same projection can serve local regulators' supplier registers.
- **Build notes:** Projection queries + exporter; `regulatory_submission` (package hash, receipt).

#### SUP-038 — Sourcing events and tenders
- **Persian name:** مناقصه، استعلام و رویدادهای تأمین
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (RFI/RFP/RFQ/RFB/RFD; weighted evaluation; award), local practice (Iranian three-envelope tenders)
- **What and how:** Sourcing events (RFI, RFP, RFQ, tender) with requirements, weighted criteria, invited suppliers answering through the portal, bids, an evaluation panel and award that creates the contract; supports the Iranian three-envelope tender (guarantee, technical, price) with sealed opening order.
- **Build notes:** `sourcing_event` (number RFX; draft=new → published=active → bidding=waiting → evaluation=active → awarded=resolved → closed; canceled) + `sourcing_bid` (envelopes, scores).

#### SUP-039 — Sourcing strategy and supplier policy
- **Persian name:** راهبرد تأمین و خط‌مشی مدیریت تأمین‌کنندگان
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (supplier strategy, sourcing models and decision factors), COBIT APO10.01
- **What and how:** Records of the sourcing strategy (insourcing, outsourcing, multi-sourcing decisions and factors), the supplier management policy and procedures, with review cadence and links to the suppliers and services they govern.
- **Build notes:** Policy documents in the knowledge module with review records.

#### SUP-040 — SIAM governance structures
- **Persian name:** ساختارهای حاکمیتی چندتأمین‌کننده (SIAM)
- **Tier:** P2 · **AI:** no
- **Sources:** SIAM BoK (boards, process forums, working groups; collaboration agreements; shared data dictionary), ISO/IEC TS 20000-14:2023
- **What and how:** Boards (strategic, tactical, operational), process forums and working groups with members from several providers, cadence, meetings, minutes, decisions and actions; collaboration agreements (non-contractual working rules between providers); cross-provider escalation and dispute paths.
- **Build notes:** `siam_forum` + `forum_meeting` (number MTG) with action tasks; `collaboration_agreement` documents.

#### SUP-041 — Cross-tenant provider trusts
- **Persian name:** اعتماد میان حساب‌ها برای همکاری تأمین‌کنندگان
- **Tier:** P2 · **AI:** no
- **Sources:** Xurrent (account trusts: tasks to trusted teams, shared roles, SLAs and FLSAs, CI support), access research
- **What and how:** Two tenants (or domains) can trust each other so that tasks are assigned to permitted teams of the provider, roles are shared, cross-tenant SLAs are registered and support of CIs is delegated (with the financial owner's consent); data stays with its owner and nothing is visible beyond the assignments.
- **Build notes:** `tenant_trust(a, b, allowed_team_ids[], shared_role_ids[])`; checked on every cross-tenant assignment.

#### SUP-042 — Supplier 360 workspace
- **Persian name:** میز کار ۳۶۰ درجهٔ تأمین‌کننده
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (Vendor Management Workspace), Freshservice (vendor links), BMC
- **What and how:** One page per supplier: contracts and renewals timeline, assets and models supplied, related tickets and issues, risk tier and assessments, scorecard, certifications, contacts and spend (if permitted).
- **Build notes:** Special page of related lists and widgets scoped by permissions; spend widget needs the financial field group.

#### SUP-043 — Supplier dashboards and reports
- **Persian name:** داشبوردها و گزارش‌های تأمین‌کنندگان
- **Tier:** P1 · **AI:** no
- **Sources:** standards (supplier reporting), COBIT APO10, EU DORA, Freshservice (vendor-wise spend), ITIL 4 (supplier KPIs)
- **What and how:** Performance trends, renewals due with notice deadlines, risk tiering, concentration, certification expiries, register completeness, dispute ageing, contract value by type, vendor-wise spend, % suppliers with a current contract and SLA, % critical suppliers with assessment and exit plan.
- **Build notes:** Shipped reports over supplier tables, scorecards and financial aggregates.

#### SUP-044 — Supply-chain compliance mapping
- **Persian name:** نگاشت انطباق زنجیرهٔ تأمین
- **Tier:** P2 · **AI:** no
- **Sources:** NIST CSF 2.0 GV.SC-01..10, ISO/IEC 27036, ISO/IEC 27001 A.5.19–5.23, EU DORA
- **What and how:** Maps supplier controls and evidence (assessments, clauses, exit plans, certifications) to framework requirements and reports coverage as audit evidence.
- **Build notes:** Control-mapping records shared with the compliance/security module.

#### SUP-045 — Collaborative relationship management (ISO 44001)
- **Persian name:** مدیریت روابط همکارانه (ISO 44001)
- **Tier:** P2 · **AI:** no
- **Sources:** ISO 44001:2017 (eight-stage collaborative lifecycle)
- **What and how:** For strategic partners: the eight stages (awareness, knowledge, internal assessment, partner selection, working together, value creation, staying together, exit), a relationship management plan, joint governance and value-creation tracking.
- **Build notes:** Stage field and plan document on `organization` for strategic suppliers; joint governance reuses SIAM forums.

#### SUP-046 — Supplier and contract access security
- **Persian name:** امنیت دسترسی به اطلاعات تأمین‌کنندگان و قراردادها
- **Tier:** P0 · **AI:** no
- **Sources:** access research (contract fields are financial fields; external persona), Freshservice (Contract Manager, Procurement Manager roles), BMC (company-scoped contracts), ServiceNow (vendor portal ACL hardening)
- **What and how:** Contract values, rates and penalties are masked without the financial field group; restricted contracts are visible only to named groups; roles supplier manager, contract manager, procurement and TPRM assessor; supplier users see only their own organization's records; contracts can be scoped by company and owning unit.
- **Build notes:** Scope profile on `contract`: own = [owner_id, contract_manager_id], group = owning group, unit = owning unit, company/domain, cost_center_subtree; restriction flag outranks grants; external persona limited to `organization_id = my org`.

### Data model

| Table | Prefix | Purpose and key fields | States (category) | Access anchors |
|---|---|---|---|---|
| `organization` | ORG | Shared directory: type flags (vendor, manufacturer, reseller, service_provider, internal_supplier, customer, partner), legal_name, national_id, economic_code, registration_no, lei, country, addresses, website, support_portal, vendor_code, category, segment, relationship_type, criticality (computed + override), risk_tier, partnership_status, supplier_state, relationship_owner_id, substitutability, iso44001_stage, bank details (financial group) | supplier_state: prospective (new); due_diligence, onboarding, active, exiting (active); under_review, suspended (waiting); inactive (closed); rejected (canceled) | own: relationship_owner_id · group: supplier management group · company/domain · external users: `organization_id = my org` |
| `supplier_contact` | — | organization_id, person data (personal group), role, escalation_level, channels, user_id, access_until | active/inactive | as organization; own record for the contact |
| `contract` | CNT | type, title, organization_id, owning unit, owner_id, contract_manager_id, parent_id, previous_contract_id, start, end, notice_period, notice_date (computed), renewal_type, auto_renew, value, currency, billing_cycle, payment schedule, cost_center_id, restricted, critical_function | draft (new); negotiation, approved, active (active); pending_approval (waiting); expired, terminated, superseded (closed); rejected, canceled (canceled) | own: owner_id, contract_manager_id · group: owning group · unit · cost_center_subtree · company/domain · restriction flag outranks grants · financial field group |
| `contract_line`, `rate_card`, `contract_amendment`, `contract_coverage` | — | item, qty, unit/fixed price, period, tax, adjustment index; role/unit rates; effective-dated amendments; covered asset/CI/entitlement/service/location/PO | — | as contract |
| `contract_obligation` | OBL | contract, party, description, owner, due_at, recurrence, breach flag | open (new); in_progress (active); waiting_counterparty (waiting); fulfilled (resolved); closed; waived (canceled) | own: owner · as contract |
| `contract_guarantee` | GUA | type (bid/performance/advance/warranty), bank, amount, currency, issue, expiry | active; extension_requested (waiting); forfeited (resolved); released (closed) | as contract (financial) |
| `contract_clause_check` | — | contract, requirement, status (met/partial/missing/n.a.), evidence quote | — | as contract |
| `scorecard_template`, `supplier_scorecard` | — | metrics and weights per segment; facts per supplier and period | — | supplier managers; aggregates for owners |
| `supplier_review` | QBR | agenda, minutes, decisions, action tasks | scheduled (new); held (active); actions_open (waiting); closed | relationship owner · participants |
| `supplier_credit_claim` | SCC | contract, breaches, computed amount, evidence, decision | draft (new); submitted (waiting); accepted/rejected (resolved); settled (closed); canceled | contract owner · financial |
| `supplier_dispute` | DIS | subject, amount, evidence, owner, decision | raised (new); under_review (active); awaiting_supplier (waiting); decided (resolved); closed; withdrawn (canceled) | own: owner · supplier managers |
| `supplier_assessment` | SAS | kind (inherent risk/due diligence/periodic/onboarding), questionnaire, responses, score, tier, assessor | draft (new); sent (waiting); in_review (active); completed (resolved); closed; canceled | own: assessor · TPRM group · external: own organization |
| `supplier_risk_issue` | SRI | assessment, finding, remediation tasks, due, exception expiry | new; analyze, remediation, review (active); awaiting_supplier (waiting); risk_accepted (resolved); closed | TPRM group · external: own organization |
| `supplier_certification`, `supplier_subcontractor` | — | type, number, issuer, scope, validity, document, verified_by; fourth party, services, data, location, approved | — | supplier managers |
| `exit_plan` | EXIT | supplier/contract, triggers, transition period, data return, substitutes, last_tested_at | draft (new); approved, tested, invoked (active); closed | relationship owner · continuity team |
| `ebond_connection`, `ebond_message` | — | endpoint, auth (secret), mapping, field ownership; message log with correlation ids | active/paused | integration admins |
| `sourcing_event`, `sourcing_bid` | RFX | type (RFI/RFP/RFQ/tender), criteria, weights, invitees; bid envelopes A/B/C, scores | draft (new); published, evaluation (active); bidding (waiting); awarded (resolved); closed; canceled | procurement group · panel members (participant) · bidders see own bid |
| `siam_forum`, `forum_meeting`, `collaboration_agreement`, `tenant_trust` | MTG (meeting) | forum type, members, cadence; minutes, actions; agreement text; trust(a, b, allowed teams, shared roles) | meeting: scheduled/held/closed | members (participant) |
| `dpa_record`, `regulatory_submission` | — | processor, sub-processors, transfer mechanism; register package hash, receipt | — | privacy/compliance officers |

**Relationships:** `organization` is referenced by `model.manufacturer_id`, `asset.vendor_id`, `purchase_order.vendor_id`, `software_product.publisher_id`, `contract.organization_id`, supplier groups (`group.organization_id`), CSM accounts; `contract_coverage → asset / ci / license_entitlement / service / location / purchase_order`; `sla_definition (type uc).contract_id → contract` (SLM); tasks carry `vendor_id`, `vendor_ticket`, `contract_id`; `supplier_credit_claim → invoice` (financial); `supplier_assessment → risk` (security/risk module).

**Access scoping:** supplier users are an **external persona**: scope limited to their own `organization_id` and to records assigned to their supplier group; no directory browsing; journal entries visible only when marked "shared with supplier"; access ends at the contract end date. Contract money fields are `financial`; restricted contracts are visible only to named groups.

### KPIs

| KPI | Formula | Notes |
|---|---|---|
| UC attainment | supplier targets met ÷ supplier targets measured | Per supplier and contract |
| Supplier-caused incidents | incidents whose cause is a supplier CI or supplier action, per period | Trend per supplier |
| Contract coverage | (critical) suppliers with a current contract and SLA ÷ (critical) suppliers | |
| Renewals before notice | renewals decided before the notice date ÷ renewals due | |
| Supplier performance score | Σ wᵢ·metricᵢ from the scorecard template | Trend |
| Critical supplier assurance | critical suppliers with current risk assessment and tested exit plan ÷ critical suppliers | |
| On-time delivery | PO lines received by the expected date ÷ PO lines received | |
| Invoice accuracy | invoices matching PO/contract ÷ invoices | |
| Dispute ageing | average days open of open disputes | |
| Assessment timeliness | assessments completed by due date ÷ assessments due | |
| Certificate validity | critical suppliers with valid certificates ÷ critical suppliers | |
| Concentration | spend (or critical functions) with the top supplier ÷ total | Also top-5 share |
| Credit recovery | credits received ÷ credits due | |
| Supplier waiting time | average time tasks spend in "awaiting supplier" | Per supplier |
| Negotiated savings | Σ (previous price − new price) × quantity at renewal | Into the savings register |
| Third-party value | value realized from suppliers (savings + outcome measures) ÷ supplier spend | ITIL v5 metric |

### Beyond the market

- **Iranian supplier identity and qualifications as data.** National ID, economic code and registration number with format checks; eNamad for online vendors; informatics rating, guild licence and AFTA product certificates with expiry alerts.
- **Iranian contract practice.** Bank guarantees (bid, performance, advance payment), retention money, price-adjustment indices and three-envelope tenders — supported natively instead of in spreadsheets.
- **Sanctions and geo-blocking risk.** Foreign providers carry a cut-off risk signal, data residency and a tested exit plan to a domestic substitute.
- **Suppliers on local channels.** Supplier technicians who do not use our portal still receive assignments and updates by SMS or Bale/Eitaa bots and reply there; e-mail/SMS fall-back for e-bonding.
- **Persian legal AI on local models.** Contract summaries, obligation extraction and clause checks work on Persian legal text and can run entirely on the tenant's model, so contracts never leave the organization.
- **Jalali notice periods.** Notice and renewal deadlines are computed in the Jalali calendar and moved off Iranian public holidays automatically.
- **E-invoice readiness.** Supplier invoices keep the national e-invoice (Moadian) unique tax id for matching and audit.
- **Regulator-ready registers.** The DORA register projection is reusable for local regulators' outsourcing and supplier registers (banking, critical infrastructure).

## Module: financial — مدیریت مالی فناوری اطلاعات

### Features

#### FIN-001 — Jalali fiscal calendar and periods
- **Persian name:** تقویم و دوره‌های مالی شمسی
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (fiscal_period), ITIL 4 (budgeting periods), standards (period-locked allocation), local practice (Iranian fiscal year from 1 Farvardin)
- **What and how:** Fiscal years and periods (months, quarters) defined in the Jalali calendar by default — the Iranian fiscal year starts on 1 Farvardin — with other calendars possible per company. Periods move open → soft-closed → closed; closed periods accept no new postings, and corrections go to the next open period with an audit trail.
- **Build notes:** `fiscal_year`, `fiscal_period` (start, end, state open=active, soft_closed=waiting, closed=closed); all financial facts keyed by period id; Jalali calendar arithmetic and fiscal-year settings come from the platform (PLT-054); this feature adds posting periods and their close.

#### FIN-002 — Currencies and exchange rates
- **Persian name:** ارزها و نرخ‌های تبدیل
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (multi-currency, reporting currency), ManageEngine SDP (multi-currency POs), ITIL 4 (multi-currency with versioned rates), analytics (convert at reporting date)
- **What and how:** Amounts are stored in transaction currency and in base currency at the applicable rate; rates are versioned by date and rate type (official, market, budget), so the same report can be shown at actual or budget rates; amounts display in Rial or Toman by user preference with Persian digit grouping.
- **Build notes:** `currency`, `exchange_rate` (from, to, rate_type, date, rate); money values stored as (amount, currency, base_amount, rate_id); display unit per user setting; the money field type itself is platform PLT-003.

#### FIN-003 — Cost centres
- **Persian name:** مراکز هزینه
- **Tier:** P0 · **AI:** no
- **Sources:** ServiceNow (cmn_cost_center with parent), BMC (cost centres; split cost centres None / Equal / User-defined %), access research (cost-centre subtree scope)
- **What and how:** A cost-centre hierarchy with owners, referenced by users, groups, units, assets, CIs, contracts, purchase orders and changes; split cost centres distribute a cost to several cost centres (equal or user-defined percentages, one level). Budget owners get access to their cost-centre subtree.
- **Build notes:** Org-unit rows of kind cost_center (shared `org_unit` tree) + `cost_center_split` (target, percent); records with cost implications carry `cct:` access keys.

#### FIN-004 — Cost types and CapEx/OpEx classification
- **Persian name:** انواع هزینه و طبقه‌بندی سرمایه‌ای و جاری
- **Tier:** P0 · **AI:** no
- **Sources:** ITIL 4 (cost types: direct/indirect, fixed/variable, CapEx/OpEx), BMC (cost categories, types, classes), standards (cost pools), TBM
- **What and how:** A tenant-editable chart of IT cost types (category → type → class: labour, hardware, software, cloud, facilities, telecom, external services) with direct/indirect, fixed/variable and CapEx/OpEx flags, used by every cost source and report.
- **Build notes:** `cost_type` tree (code, capex_opex, direct, fixed, gl_account default); referenced by cost entries and budget lines.

#### FIN-005 — Cost ledger with period close
- **Persian name:** دفتر هزینه با بستن دوره
- **Tier:** P1 · **AI:** no
- **Sources:** BMC (ledger-style cost entries, charge-back cycle closes the period), ServiceNow (fm_expense_line), ITIL 4 (periods locked after close; corrections in next period), standards (reproducible, immutable after close)
- **What and how:** Every cost becomes a ledger entry: source (asset purchase or depreciation, lease, contract billing, licence or subscription, labour, cloud bill, invoice, manual), amount and currency, period, cost centre, cost type, CapEx/OpEx and links to CI, asset, service, offering, project, supplier and contract. Entries are immutable once their period closes; corrections are reversal entries in an open period.
- **Build notes:** `cost_entry` (source_type, source_id, amount, currency, base_amount, period_id, cost_center_id, cost_type_id, capex_opex, ci_id, asset_id, service_id, offering_id, project_id, vendor_id, contract_id, reversal_of); insert-only with a close check trigger.

#### FIN-006 — Automated cost capture from source records
- **Persian name:** ثبت خودکار هزینه از رکوردهای مبدأ
- **Tier:** P1 · **AI:** no
- **Sources:** ServiceNow (expense lines from assets, contracts, labour, cloud bills, subscriptions), BMC (asset, contract and licence costs), Freshservice (contract billing cycles and PO totals)
- **What and how:** Scheduled jobs generate ledger entries from operational records: contract billing per cycle, licence and SaaS subscriptions, lease payments, PO receipts, consumable issues, repairs and write-offs, labour from time entries; each entry links back to its source and is idempotent per source and period.
- **Build notes:** Generator jobs per source with dedupe key (source, period); preview mode before the first run of a period.

#### FIN-007 — Depreciation posting and asset financials
- **Persian name:** ثبت استهلاک و اطلاعات مالی دارایی‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** standards (asset financials: purchase cost, depreciation schedule, lease, residual value, capex/opex, maintenance cost), BMC (Financials tab on CIs), GLPI (TCO), ITIL 4 (book value derived)
- **What and how:** Monthly depreciation from ITAM's calculators is posted to the ledger; each asset and CI has a financial tab (purchase cost, accumulated depreciation, book value, lease, maintenance and repair cost, allocated cost) visible only to financial roles.
- **Build notes:** Monthly job reads `asset_value_snapshot` and writes `cost_entry` rows (cost type depreciation); financial tab is a related view with field group financial.

#### FIN-008 — Labour costing and rates
- **Persian name:** هزینهٔ نیروی انسانی و نرخ‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (effort and time tracking → labour cost), ManageEngine SDP (technician cost per hour, worklog cost), BMC (cost rates by assignee group), Xurrent (effort classes), Halo (charge rates per labour type, out-of-hours multipliers)
- **What and how:** Effective-dated rates per person, role or group (and effort class), with out-of-hours multipliers; time entries on incidents, requests, changes, problems and projects get a computed cost and a CapEx/OpEx flag (capitalizable project work vs run work), giving cost per ticket, per service and per customer.
- **Build notes:** `labour_rate` (subject_type, subject_id, effort_class, rate, currency, multiplier rules, valid dates); cost computed on time-entry write and posted monthly.

#### FIN-009 — ERP and general-ledger integration
- **Persian name:** یکپارچگی با نرم‌افزار مالی و دفتر کل
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (actuals imported from ERP/GL with a mapping table), standards (GL and procurement data into cost pools), BMC (posting to the general ledger)
- **What and how:** Imports actuals from the organization's accounting system (file or API) with a GL-account → cost-type/cost-pool mapping, exports journal entries for chargeback and accruals, and shows a reconciliation report between the ledger and the ERP; ready adapters for common Iranian accounting and ERP systems by file format or API.
- **Build notes:** `gl_account`, `gl_mapping`; connector jobs in lane external; unmapped lines land in the financial exceptions queue.

#### FIN-010 — Budgets
- **Persian name:** بودجه
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (budgets per cost centre, service and project; approval), ISO/IEC 20000-1 §8.4.1, COBIT APO06, ServiceNow (Financial Planning: top-down targets, bottom-up requests), Ivanti (portfolio budgets)
- **What and how:** Budgets per fiscal year by cost centre, service, project and cost type, with versions (original, revised, forecast), top-down targets and bottom-up requests, submission and approval workflow and locking; budget lines can come from refresh forecasts, renewals and true-up forecasts.
- **Build notes:** `budget` (number BDG; draft=new → submitted=waiting → approved=active → revised=active → locked=closed; rejected=canceled) + `budget_line` (period, cost_center, cost_type, service, project, amount); one fact table with actuals and forecasts for variance.

#### FIN-011 — Forecasts
- **Persian name:** پیش‌بینی هزینه‌ها
- **Tier:** P1 · **AI:** yes
- **Sources:** ITIL 4 (rolling forecasts; forecast accuracy), standards (forecasting of service costs and cloud spend), ServiceNow (forecast and variance)
- **What and how:** Rolling forecasts per cost centre, service and cost type that combine committed costs (contracts, leases, subscriptions), run-rate trends and planned items (refresh, renewals, projects); a statistical/AI forecast with prediction intervals is offered as a starting point and its accuracy is tracked.
- **Build notes:** `forecast` (number FCT; version, lines); models in code (seasonal decomposition with Jalali months, committed-cost schedules); LLM explains the main drivers.

#### FIN-012 — Variance analysis and alerts
- **Persian name:** تحلیل انحراف بودجه و هشدار
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (variance = actual − budget), ISO/IEC 20000-1 §8.4.1, COBIT APO06, ServiceNow (budget vs actual vs forecast)
- **What and how:** Budget vs actual vs forecast per cell (period, cost centre, service, cost type) with variance amounts and percentages, thresholds that alert owners, and drill-down to the ledger entries behind each number.
- **Build notes:** Pivot over the shared fact table; notification rules on variance thresholds evaluated after each posting run.

#### FIN-013 — AI variance and cost-driver explanations
- **Persian name:** توضیح هوشمند انحراف‌ها و عوامل هزینه
- **Tier:** P1 · **AI:** yes
- **Sources:** ServiceNow (generative variance explanations in financial planning), ai research (narrate month-over-month drivers from deterministic data)
- **What and how:** For any variance or month-over-month change, explains the main drivers in plain Persian ("software +18%: Microsoft renewal two months early and 40 new seats"), citing the ledger entries and source records.
- **Build notes:** Variance decomposition in code (by cost type, supplier, source); LLM narrates only from the decomposition; respects field groups.

#### FIN-014 — Cost model and allocation rules
- **Persian name:** مدل هزینه و قواعد تسهیم
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (cost pools, allocation drivers, allocation to services and consumers), TBM Taxonomy 5.0, ServiceNow (Cost Transparency: cost models), standards (allocation rules direct/usage-based/fixed %)
- **What and how:** A configurable allocation graph: cost sources → cost pools → towers → services and applications → consumers (business units, products), each edge with a rule: direct, fixed percentage, even split or driver-based (users, devices, tickets, CI count, storage, CPU hours, licences); rules are versioned per period.
- **Build notes:** `cost_taxonomy_node` (level pool|tower|sub_tower|solution|consumer) + `allocation_rule` (from, to[], method, driver_metric, percent, version, valid periods).

#### FIN-015 — Allocation runs
- **Persian name:** اجرای تسهیم هزینه
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (allocation runs draft/approved/locked), standards (period-locked, reproducible, immutable allocation run), BMC (preview → approve → post → close)
- **What and how:** Each period's allocation runs as a batch over a frozen input set (ledger extract, driver values, rule version): preview, review, approve and lock; locked runs are immutable and reproducible, and every allocated amount can be drilled from consumer to service to tower to pool to the original ledger lines.
- **Build notes:** `allocation_run` (number ALC; draft=new → calculated=active → in_review=waiting → approved=resolved → locked=closed; discarded=canceled) + `allocation_result` (run, from_node, to_node, amount); input hashes stored for reproducibility.

#### FIN-016 — Driver metrics
- **Persian name:** محرک‌های هزینه
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (allocation drivers), standards (usage-based allocation), analytics (driver-based allocation by tickets, users or CIs)
- **What and how:** Driver values per period and consumer are captured automatically from the platform (tickets per unit, users, devices, CIs per service, storage, licences, catalogue orders) or imported (CPU hours, network traffic), and can be reviewed before an allocation run.
- **Build notes:** `driver_metric` (period, metric, object_type, object_id, value, source); collectors as scheduled aggregate queries.

#### FIN-017 — TBM taxonomy
- **Persian name:** طبقه‌بندی TBM
- **Tier:** P2 · **AI:** no
- **Sources:** TBM Taxonomy 5.0 / 5.0.1 (towers incl. Data, Risk & Compliance, IoT; AI solution type), standards, ServiceNow (TBM alignment)
- **What and how:** A ready TBM taxonomy (cost pools, towers and sub-towers, solutions, consumers) that tenants can adopt or adapt, enabling benchmark-style reports.
- **Build notes:** Seed content for `cost_taxonomy_node`; stored as configurable taxonomy, not hard-coded.

#### FIN-018 — AI-suggested allocation keys
- **Persian name:** پیشنهاد هوشمند کلیدهای تسهیم
- **Tier:** P2 · **AI:** yes
- **Sources:** standards (suggested allocation keys from usage correlations)
- **What and how:** Suggests drivers for pools that are allocated by flat percentages, from correlations between cost and usage signals (for example storage cost vs GB used per unit), with the evidence and expected effect on each consumer.
- **Build notes:** Correlation analysis in code; LLM writes the recommendation; adopting a key creates a draft rule version.

#### FIN-019 — Service and unit costing
- **Persian name:** هزینهٔ تمام‌شدهٔ خدمت و هزینهٔ واحد
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (cost per service and unit; economic modelling), ServiceNow (unit cost per offering, TCO per application), standards (unit costs per ticket, user, device, GB, transaction)
- **What and how:** Cost per service, offering and application (direct plus allocated) and unit costs per user, device, ticket, GB or transaction, with trends; these feed price lists, rationalization and the service owner's scorecard.
- **Build notes:** Derived from locked allocation runs and driver metrics; `unit_cost_fact` (period, object, unit, cost).

#### FIN-020 — Catalogue item price and cost-based approvals
- **Persian name:** قیمت اقلام کاتالوگ و تأیید بر اساس هزینه
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (catalog item cost shown on portal, cost in approval conditions), BMC (DWP prices and cost adjustments by options), ServiceNow (catalog item pricing one-time and recurring)
- **What and how:** Catalogue items show a one-time and/or recurring price at order time, adjusted by the options chosen; the price is stored on the requested item and can drive approval conditions (e.g. above an amount the department head approves) and later chargeback.
- **Build notes:** Price fields on catalog items and variables with price modifiers; `requested_item.price_snapshot`; approval conditions use it.

#### FIN-021 — Versioned price lists and rate cards
- **Persian name:** فهرست قیمت و نرخ‌نامهٔ نسخه‌دار
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (unit-cost pricing; price-list versioning and effective dates), standards (internal price lists per offer), IT4IT (chargeback component)
- **What and how:** Internal price lists per offering, catalogue item and consumption unit (seat, VM-month, GB-month, ticket), versioned with effective dates, derived from unit costs plus a margin or set manually; offerings and catalogue items reference the price list.
- **Build notes:** `price_list` + `price_list_item` (object, unit, price, currency, valid_from, valid_to, version).

#### FIN-022 — Showback statements
- **Persian name:** گزارش هزینهٔ مصرف واحدها (Showback)
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (showback), standards (showback statements from subscriptions and usage), IT4IT (Chargeback/Showback)
- **What and how:** Periodic statements per consumer unit that show what its use of services cost (allocated cost or price × usage) with drill-down to services, subscriptions and usage, without generating charges.
- **Build notes:** Statement rendering from allocation results or price × usage; PDF in Persian; visible to unit managers by cost-centre scope.

#### FIN-023 — Chargeback runs, statements and disputes
- **Persian name:** صدور صورت‌حساب داخلی (Chargeback) و رسیدگی به اعتراض‌ها
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (chargeback: rate cards, billing runs, statements, disputes), BMC (charge-back cycle: review, preliminary invoices, post to GL, close; charge-back percentage surcharge), standards (disputes as requests)
- **What and how:** Chargeback runs per period: preview, approve, post (journal export to the ERP) and close; statements per consumer are immutable once issued; an optional surcharge percentage applies; consumers dispute charges through a request, and accepted disputes become adjustment lines in a later run rather than edits to history.
- **Build notes:** `chargeback_run` (number CHB; preview=new → in_review=waiting → approved=active → posted=resolved → closed; canceled) + `chargeback_statement` (number STM) + lines; disputes as request type creating adjustment entries.

#### FIN-024 — AI chargeback narratives
- **Persian name:** روایت هوشمند صورت‌حساب داخلی
- **Tier:** P2 · **AI:** yes
- **Sources:** ai research (chargeback narratives: LLM summarizes month-over-month drivers from deterministic allocations)
- **What and how:** Each statement gets a short explanation of why the unit's charges changed (new subscriptions, more tickets, a price change), written from the deterministic allocation and usage data.
- **Build notes:** Diff of statement lines vs previous period computed in code; LLM narration only.

#### FIN-025 — Internal billing plans for holdings and MSPs
- **Persian name:** طرح‌های صورت‌حساب برای هلدینگ‌ها و ارائه‌دهندگان خدمات
- **Tier:** P2 · **AI:** no
- **Sources:** Halo (billing plans: recurring invoices, prepaid hours or amounts, block hours, accounting sync), Xurrent (billable time per offering), BMC (MSP credit management)
- **What and how:** For IT units serving subsidiaries or external clients: billing plans with recurring fees, prepaid hours or amounts (block hours) drawn down by billable time under rules (labour type, out-of-hours multiplier), prorated recurring invoices and exports to the accounting system.
- **Build notes:** `billing_plan` + `prepaid_txn` (plan, delta, source time_entry|invoice|adjustment); invoice generation by schedule.

#### FIN-026 — Cost of service failure
- **Persian name:** هزینهٔ ازکارافتادگی خدمات
- **Tier:** P1 · **AI:** no
- **Sources:** standards (incident and outage cost: lost revenue, productivity via perceived lost time, penalties; EU DORA economic impact), analytics (cost of downtime = cost per hour × outage hours)
- **What and how:** Each service has a downtime cost profile (revenue per hour, affected users × loaded hourly cost, contractual penalties); outages and major incidents get an estimated cost that feeds problem prioritization, business cases for resilience and regulatory impact classification.
- **Build notes:** `downtime_cost_profile` (service, revenue_per_hour, users, hourly_cost, penalty rules); cost computed on outage close and stored on the outage/incident.

#### FIN-027 — Support economics
- **Persian name:** اقتصاد پشتیبانی
- **Tier:** P1 · **AI:** no
- **Sources:** HDI and MetricNet (cost per contact/ticket by channel and tier), KCS v6 (self-service value), analytics (self-service savings)
- **What and how:** Cost per ticket or contact by channel, tier and service; self-service cost avoidance (deflected tickets × cost per ticket − self-service running cost); knowledge and AI value measures; benchmark comparison with published ranges.
- **Build notes:** Labour cost and allocated tool costs divided by ticket counts per period; deflection counts from portal and AI analytics.

#### FIN-028 — Business cases and investment appraisal
- **Persian name:** طرح توجیهی و ارزیابی سرمایه‌گذاری
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (investment appraisal ROI, NPV, payback; business cases), COBIT APO05/EDM02, ServiceNow (cost and benefit plans on demands)
- **What and how:** Business cases for service proposals, demands and projects with cost and benefit cash flows by period, discount rate and assumptions; ROI, NPV, IRR and payback are computed, compared between options and approved; assumptions are kept for later benefits comparison.
- **Build notes:** `business_case` (number BC; draft=new → in_review=waiting → approved=active → realizing=active → closed; rejected=canceled) + `cash_flow_line`; formulas in code (NPV = Σ CFt/(1+r)^t − I0).

#### FIN-029 — Benefits realization tracking
- **Persian name:** پیگیری تحقق منافع
- **Tier:** P2 · **AI:** no
- **Sources:** ITIL 4 (benefits register), COBIT EDM02, project research (benefits register)
- **What and how:** Benefits from approved business cases with owner, baseline, target, measure and due date; actual values recorded over time and compared with the plan; shared with the project and portfolio module.
- **Build notes:** `benefit` (business_case, owner, baseline, target, measure, actuals[]).

#### FIN-030 — Savings and cost-avoidance register
- **Persian name:** ثبت صرفه‌جویی‌ها و هزینه‌های اجتناب‌شده
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (harvest savings, rationalization savings), standards (realized savings: ITAM harvest, rightsizing), analytics (contract metrics: cost avoidance)
- **What and how:** Savings initiatives (licence harvesting, renegotiation, consolidation, rightsizing, refresh deferral) with planned vs realized amounts, evidence and owner; reclamation and renewals post savings automatically.
- **Build notes:** `savings_record` (number SAV; identified=new → approved=active → in_progress=active → realized=resolved → closed; canceled) linked to source records.

#### FIN-031 — Spend approval authority matrix and budget check
- **Persian name:** ماتریس اختیارات تأیید هزینه و کنترل بودجه
- **Tier:** P1 · **AI:** no
- **Sources:** COBIT APO06 (delegation-of-authority matrix), access research (authority thresholds by amount band), standards (segregation of duties)
- **What and how:** Amount bands per cost centre and spend type define who approves purchases, contracts, catalogue orders and costly changes (cost-centre owner, finance, management); a budget-availability check runs before approval; segregation of duties stops people approving their own spend.
- **Build notes:** `spend_authority_rule` (cost_center scope, spend_type, min, max, approver source) consumed by approval rules; budget check reads remaining budget per line.

#### FIN-032 — Supplier invoices and three-way match
- **Persian name:** صورت‌حساب تأمین‌کنندگان و تطبیق سه‌طرفه
- **Tier:** P2 · **AI:** no
- **Sources:** standards (three-way match status), ManageEngine SDP (invoices and payments on POs), ITIL 4 (invoice accuracy), local practice (Iranian e-invoice tax id)
- **What and how:** Supplier invoices are recorded against POs and contracts (number, date, lines, tax, the Iranian tax system's unique invoice id where applicable) and matched with order and receipt (three-way) or contract rates; mismatches go to exceptions; supplier credits are offset; payment status comes from the ERP.
- **Build notes:** `invoice` (number INV; received=new → matching=active → exception=waiting → approved=resolved → paid=closed; rejected=canceled) + `invoice_line`; match engine in code.

#### FIN-033 — AI invoice capture and validation
- **Persian name:** ثبت و اعتبارسنجی هوشمند صورت‌حساب
- **Tier:** P2 · **AI:** yes
- **Sources:** standards (invoice and contract data extraction), ITIL 4 (invoice anomaly detection), ServiceNow (DocIntel)
- **What and how:** Reads invoices (PDF or scans, including Persian official invoices) into structured lines with page citations, then flags anomalies: duplicates, prices above the contract rate, items not ordered, tax errors.
- **Build notes:** Platform document-extraction pipeline (PLT-066); validation rules in code; LLM explains flagged anomalies.

#### FIN-034 — Cloud cost ingestion (FOCUS)
- **Persian name:** دریافت هزینه‌های ابری با قالب FOCUS
- **Tier:** P2 · **AI:** no
- **Sources:** FinOps FOCUS 1.x (incl. 1.4 contract commitment and invoice detail datasets), ServiceNow (Cloud Cost Management), standards (cloud cost and usage)
- **What and how:** Cloud and SaaS billing data in FOCUS format (billed and effective cost, service category, tags, commitments) is ingested per account; rows map to cost types, services and consumers, and unmatched rows go to an "unallocated" bucket with an owner; adapters convert bills from providers that do not offer FOCUS (including Iranian clouds).
- **Build notes:** `cloud_cost_line` (FOCUS columns subset) → `cost_entry` aggregation daily; mapping rules by tag and account.

#### FIN-035 — Tag-based cloud allocation and tagging compliance
- **Persian name:** تسهیم ابری بر اساس برچسب و انطباق برچسب‌گذاری
- **Tier:** P2 · **AI:** no
- **Sources:** FinOps Framework, standards (tag-based allocation, untagged-spend tracking), ServiceNow (Tag Governance)
- **What and how:** Allocates cloud cost by tags (service, cost centre, environment) and reports untagged or wrongly tagged spend with owners and trends.
- **Build notes:** Allocation rules keyed by tag values; untagged share computed daily; links to CMDB tag policies (CMDB-071).

#### FIN-036 — Cloud optimization and commitments
- **Persian name:** بهینه‌سازی هزینهٔ ابری و تعهدات خرید
- **Tier:** P2 · **AI:** yes
- **Sources:** ServiceNow (rightsizing and idle-resource recommendations with remediation), BMC (Continuous Optimization), Freshservice (Cloud Recommendation Engine), Flexera (agentic commitment management, reported)
- **What and how:** Rightsizing and idle or unattached resource recommendations with expected savings, commitment (reserved capacity, savings plans) coverage and utilization, and an optional agent that proposes commitment purchases; actions run through approved workflows.
- **Build notes:** Rules over utilization metrics + optimization calculations in code; agent in propose mode.

#### FIN-037 — Spend anomaly detection
- **Persian name:** کشف ناهنجاری هزینه‌ها
- **Tier:** P1 · **AI:** yes
- **Sources:** standards (spend anomaly detection), ai research (STL + robust z-score with currency floor), ServiceNow (cloud cost anomaly detection)
- **What and how:** Daily spend per cost centre, service and supplier is checked for anomalies; alerts go to owners when the deviation is large in both statistical and absolute terms, with an AI explanation built from the top contributing lines.
- **Build notes:** STL decomposition + robust z-score on residuals; alert when > 3.5 MAD and above a currency floor; `cost_anomaly` (number ANO; detected=new → investigating=active → explained=resolved → closed; false_positive=canceled).

#### FIN-038 — Financial data-quality exceptions
- **Persian name:** استثناهای کیفیت دادهٔ مالی
- **Tier:** P1 · **AI:** no
- **Sources:** ITIL 4 (exceptions queue: unallocated costs, missing cost centre, untagged spend; financial audit trail)
- **What and how:** A queue of financial data problems — unallocated or unmapped costs, assets and CIs without a cost centre, contracts without cost type, untagged cloud spend — each with an owner and due date, plus a financial audit trail.
- **Build notes:** `financial_exception` (number FEX; open=new → in_progress=active → resolved → closed; ignored=canceled) generated by validation jobs with idempotent keys.

#### FIN-039 — IT spend views
- **Persian name:** نماهای هزینهٔ فناوری اطلاعات
- **Tier:** P0 · **AI:** no
- **Sources:** Freshservice (vendor-wise spend via contract/PO reports; SaaS spend), ManageEngine SDP (asset allocation cost per user/department), ITIL 4 (spend reporting)
- **What and how:** Out-of-the-box views of IT spend by supplier, cost centre, department, cost type and service, built from contracts, purchase orders, assets, licences and SaaS subscriptions (before any ledger or allocation is set up), filtered by Jalali periods and exportable.
- **Build notes:** Union view over source tables with money fields; field group financial required; later switched to `cost_entry` when the ledger is active.

#### FIN-040 — Financial dashboards and reports
- **Persian name:** داشبوردها و گزارش‌های مالی
- **Tier:** P1 · **AI:** no
- **Sources:** standards (budget vs actual vs forecast per service and BU, unit-cost trends, allocation transparency, realized savings, chargeback statements), COBIT MEA01, InvGate (refresh and depreciation dashboard)
- **What and how:** Budget vs actual vs forecast per service and business unit, unit-cost trends, allocation transparency (drill from consumer to service, tower, pool and ledger line), cloud spend by FOCUS dimensions, realized savings, chargeback statements, refresh and depreciation, AI cost, and executive one-page summaries.
- **Build notes:** Shipped dashboards over the fact tables; aggregate-only widgets for executives.

#### FIN-041 — Financial field security and aggregate-only access
- **Persian name:** امنیت فیلدهای مالی و دسترسی فقط تجمیعی
- **Tier:** P0 · **AI:** no
- **Sources:** access research (financial fields masked everywhere; aggregate-only grants with small-cell suppression; cost-centre subtree scope), GLPI (financial information rights), BMC (company-scoped financial records)
- **What and how:** Every money field belongs to the financial field group and is masked in lists, forms, history, notifications, exports, search, offline copies and AI prompts unless the user holds it. Budget owners can get cost-centre-subtree scope; executives can get aggregate-only access to dashboards (no row access, small groups suppressed).
- **Build notes:** Field group financial enforced by the record service; `report_aggregate` grant with minimum cell size; `cct:` access keys on financial records.

#### FIN-042 — Inflation- and exchange-rate-aware reporting
- **Persian name:** گزارش‌گری با درنظرگرفتن تورم و نرخ ارز
- **Tier:** P1 · **AI:** no
- **Sources:** local context (high inflation and multiple exchange rates in Iran), ITIL 4 (multi-currency), standards (unit-cost trends)
- **What and how:** Reports can show nominal and real (inflation-adjusted) values using an official price index, compare periods at constant prices, show foreign-currency purchases at historical and current rates and estimate replacement cost of the asset base.
- **Build notes:** `price_index` (period, index) and rate types in `exchange_rate`; report option "real terms" = nominal × index_base / index_period.

#### FIN-043 — Sustainability accounting
- **Persian name:** حسابداری پایداری
- **Tier:** P2 · **AI:** no
- **Sources:** ISO/IEC TS 20000-16:2025, ISO/IEC 21031:2024 (Software Carbon Intensity), standards (energy and carbon per service and asset)
- **What and how:** Energy use and carbon emissions per service, asset and site (from asset attributes, data-centre power and cloud provider data), software carbon intensity for applications and reports alongside cost.
- **Build notes:** Carbon factors per energy source and site; aggregates over assets and cloud lines; `carbon_fact`.

#### FIN-044 — AI usage cost accounting
- **Persian name:** حسابداری هزینهٔ هوش مصنوعی
- **Tier:** P2 · **AI:** no
- **Sources:** ai research (token, credit and session metering; ROI dashboards; AI cost per resolution), ServiceNow (AI Control Tower cost tracking)
- **What and how:** The tenant's own model usage (tokens × price per model, local GPU cost) becomes a cost source allocated to services, skills and agents, with budgets and alerts per agent and an ROI view comparing AI cost with time saved.
- **Build notes:** AI usage records from the AI layer aggregated monthly into `cost_entry` (cost type AI); price table per model configurable.

#### FIN-045 — Project and portfolio financial linkage
- **Persian name:** پیوند مالی پروژه‌ها و سبد سرمایه‌گذاری
- **Tier:** P2 · **AI:** no
- **Sources:** ServiceNow (SPM cost and benefit plans, actuals from time cards and expense lines), Ivanti (portfolio budgets), ITIL 4 (portfolio financial roll-ups)
- **What and how:** Projects and demands carry cost plans and benefit plans by fiscal period with CapEx/OpEx split; actuals come from time entries and ledger lines; budget vs actual vs forecast rolls up to programmes and portfolios (shared with the project module).
- **Build notes:** `project_id` on `cost_entry` and `budget_line`; roll-ups by portfolio tree.

### Data model

| Table | Prefix | Purpose and key fields | States (category) | Access anchors |
|---|---|---|---|---|
| `fiscal_year`, `fiscal_period` | — | calendar (Jalali default), start, end, company | period: open (active); soft_closed (waiting); closed (closed) | finance admins |
| `currency`, `exchange_rate`, `price_index` | — | code, display unit (rial/toman); from, to, rate_type (official/market/budget), date, rate; CPI series | config | read all; write finance admins |
| `org_unit` (kind cost_center), `cost_center_split` | — | shared org tree with owner; split targets and percents | — | cost_center_subtree |
| `cost_type`, `gl_account`, `gl_mapping` | — | category/type/class, capex_opex, direct, fixed; GL account → cost type/pool | config | finance admins |
| `cost_entry` | — | source_type, source_id, amount, currency, base_amount, rate_id, period_id, cost_center_id, cost_type_id, capex_opex, ci_id, asset_id, service_id, offering_id, project_id, vendor_id, contract_id, description, reversal_of | — (insert-only; locked with the period) | cost_center_subtree · unit · domain · financial field group · aggregate-only for executives |
| `budget`, `budget_line` | BDG | fiscal year, version (original/revised/forecast), owner; lines by period, cost centre, cost type, service, project | draft (new); submitted (waiting); approved, revised (active); locked (closed); rejected (canceled) | own: owner · cost_center_subtree |
| `forecast`, `forecast_line` | FCT | version, method, lines with low/high | draft/published/superseded | as budget |
| `cost_taxonomy_node`, `allocation_rule`, `driver_metric` | — | pool/tower/sub_tower/solution/consumer tree; method (direct/percent/even/driver), driver, version, valid periods; period driver values | config | finance admins |
| `allocation_run`, `allocation_result`, `unit_cost_fact` | ALC | period, rules version, input hashes; from/to node, amount; unit costs per object | draft (new); calculated (active); in_review (waiting); approved (resolved); locked (closed); discarded (canceled) | finance; results readable by cost-centre owners |
| `labour_rate` | — | subject (person/role/group), effort class, rate, currency, multipliers, valid dates | config | financial + personal groups |
| `price_list`, `price_list_item` | — | object (offering/catalog item/unit), unit, price, currency, version, valid dates | config | read: requesters see prices of what they can order |
| `chargeback_run`, `chargeback_statement`, `chargeback_line` | CHB / STM | period, surcharge %; consumer unit, lines, totals, issued_at | run: preview (new); in_review (waiting); approved (active); posted (resolved); closed; canceled · statement: issued (active); disputed (waiting); settled (closed) | cost_center_subtree of the consumer |
| `billing_plan`, `prepaid_txn` | — | client, recurring fee, prepaid hours/amount; balance deltas from time entries and invoices | active/ended | finance · account managers |
| `downtime_cost_profile` | — | service, revenue per hour, users, hourly cost, penalty rules | config | service owners · finance |
| `business_case`, `cash_flow_line`, `benefit` | BC | linked proposal/demand/project, discount rate, assumptions, ROI/NPV/IRR/payback (computed); flows by period; benefit baseline, target, actuals | draft (new); in_review (waiting); approved, realizing (active); closed; rejected (canceled) | own: sponsor · portfolio board |
| `savings_record` | SAV | source (harvest/renegotiation/consolidation/rightsizing), planned, realized, evidence, owner | identified (new); approved, in_progress (active); realized (resolved); closed; canceled | own: owner · finance |
| `spend_authority_rule` | — | cost-centre scope, spend type, amount band, approver source | config | finance admins |
| `invoice`, `invoice_line` | INV | vendor, PO, contract, number, date, tax id (Moadian), lines, tax, match status | received (new); matching (active); exception (waiting); approved (resolved); paid (closed); rejected (canceled) | procurement · finance · cost_center_subtree |
| `cloud_cost_line` | — | FOCUS subset (billed/effective cost, service category, account, region, tags, commitment) | — | finance · cloud owners (tag scope) |
| `cost_anomaly` | ANO | object, period, expected, actual, score, explanation | detected (new); investigating (active); explained (resolved); closed; false_positive (canceled) | cost-centre owner |
| `financial_exception` | FEX | kind (unallocated/unmapped/missing cost centre/untagged), object, owner, due | open (new); in_progress (active); resolved; closed; ignored (canceled) | own: owner · finance |
| `carbon_fact` | — | period, object (asset/service/site), energy, emissions | — | read all (aggregate) |

**Relationships:** `cost_entry` links to every cost source (`asset`, `contract`, `license_entitlement`, `saas_subscription`, `purchase_order`, `invoice`, time entries, `cloud_cost_line`, AI usage) and to the objects it is charged to (`ci`, `service`, `service_offering`, `project`, cost centre); `allocation_result` → `cost_taxonomy_node` → `service`/consumer units; `price_list_item` ← `service_offering`, `catalog_item`; `business_case` ← `service_proposal`, demand, project; `invoice` ↔ `purchase_order`, `goods_receipt`, `contract`, `supplier_credit_claim`.

**Access scoping:** every money field is in field group `financial`; budget owners hold `cost_center_subtree`; executives may hold `report_aggregate` only (no row access, small cells suppressed); requester-facing prices are visible only for items the requester may order. Requester-derived anchors (cost centre of the requester) are **snapshotted** on financial records so reorganizations do not re-scope history.

### KPIs

| KPI | Formula | Notes |
|---|---|---|
| Cost per service / user / device | allocated cost ÷ units | From locked allocation runs |
| Cost per ticket | (labour + tools + facilities + overhead of the service desk) ÷ tickets handled | Benchmarks: ≈ US$20–22 blended L1 contact (HDI/MetricNet); desktop support far higher |
| Budget variance % | (actual − budget) ÷ budget | Per cell and roll-up |
| Forecast accuracy | 1 − abs(forecast − actual) ÷ actual | Per period |
| Allocation coverage | costs allocated to services ÷ total IT cost | Target ≥ 90% |
| Chargeback recovery | amounts recovered ÷ amounts allocated to consumers | |
| Unallocated / untagged spend | unallocated (untagged) spend ÷ total (cloud) spend | |
| Cloud waste | idle or unattached spend ÷ cloud spend | |
| Unit-cost trend | unit cost(period) ÷ unit cost(previous period) − 1 | Nominal and real |
| Cost of downtime | cost per hour × outage hours (+ affected users × hours × loaded hourly cost + penalties) | Per outage and service |
| Self-service savings | deflected tickets × cost per ticket − self-service running cost | |
| ROI | (benefits − costs) ÷ costs | Business cases |
| NPV | Σ CFₜ ÷ (1 + r)ᵗ − I₀ | |
| Payback period | first period where cumulative cash flow ≥ 0 | |
| Overhead share | overhead costs ÷ total costs | ITIL v5 metric |
| Financial data quality | assets and CIs with a cost centre ÷ assets and CIs; open financial exceptions | |
| Realized savings | Σ realized ÷ Σ planned savings | Savings register |
| Real-terms growth | (1 + nominal growth) ÷ (1 + inflation) − 1 | Uses the price index |
| AI cost per resolution | AI cost ÷ tickets resolved with AI | With time saved for ROI |

### Beyond the market

- **Jalali fiscal year as the default.** Periods from 1 Farvardin, Esfand year-end close, Persian statements and Jalali buckets in every report — leading tools assume Gregorian fiscal calendars.
- **Inflation and multi-rate reporting.** Nominal vs real terms with an official price index, official vs market exchange rates and replacement-cost views — essential in a high-inflation economy and absent from global tools.
- **Iranian ERP integration.** Ready import/export formats for common Iranian accounting and ERP systems, so actuals and chargeback journals move without manual spreadsheets.
- **Holding-company chargeback.** Internal billing between subsidiaries of a holding with legal-entity separation, shared IT service centres and Persian official statements.
- **Persian variance explanations on local models.** "Why did software spend rise?" answered in Persian with citations, computed deterministically and narrated by the tenant's own model, so financial data stays in the organization.
- **Honest AI economics.** BYO-model cost (cloud tokens or local GPU) appears as a cost source with ROI next to time saved — vendors meter their own credits instead.
- **Offline, aggregate-only executive views.** Executives can review budgets on the Windows app offline with aggregate-only data (no row access), synced under the same permission rules.
- **E-invoice and VAT awareness.** Invoice capture keeps the national e-invoice id and VAT details for three-way matching and audit.

## Deliberately excluded

| Item (source) | Reason |
|---|---|
| Vendor licensing and metering mechanics: JSM object allowances and usage packs, Freshservice Asset Units and ITAM Classic packaging, ServiceNow counting of its own fulfiller licences, Rovo credits | Commercial models of those vendors, not capabilities our customers need; our own AI cost visibility is FIN-044 |
| Vendor-specific migrations and product reshuffles: JSM Services-schema migration (2026), Assets as a standalone platform app, ServiceNow Service Graph Workspace merge, Unified Map replacing CMDB Baseline, deprecated SPM Service Owner Workspace | We build the end state directly (CMDB-072, CMDB-037, SPF-016) |
| JSM Assets technical limits (objects per site, attributes per type, text lengths) | Product constraints, not features; our scale targets are listed in Engine requirements |
| Platform-generic items: ATF quick-start tests for CMDB, accessibility reflow, generic CSV export and saved views, Confluence Assets macro | Owned by the platform/admin group and the UI kit; the CMDB-specific part is CMDB-021 and CMDB-079 |
| Network automation: NetBox config contexts and Jinja2 config rendering, device-configuration assurance | Network-automation tooling outside ITSM; we keep IPAM and racks as inventory (CMDB-067, CMDB-068) and intended-vs-actual drift (CMDB-059) |
| Endpoint-management execution: patch deployment, software distribution, remote-control engines, RMM scripting (Client Management, Endpoint Central, Atera Autopilot) | Integrated through connectors and approved actions (CMDB-056, ITAM-040) rather than rebuilt |
| Mainframe and OT discovery probes (partner-specific) | Specialised probes; data can arrive through connectors or the IRE API (CMDB-077) |
| ERP and source-to-pay depth: accounts payable, payment runs, general-ledger posting engine, tax filing to the Moadian system, Xero/QuickBooks sync | Belongs to ERP; we integrate (FIN-009) and keep invoice matching as P2 (FIN-032) |
| Full enterprise asset management (manufacturing maintenance, medical-device regulation, linear assets) | Outside ITSM; generic non-IT classes only (ITAM-045) |
| Secrets management (rotating machine credentials, vaulting service accounts) | We inventory machine identities (CMDB-060) and store our own discovery credentials (CMDB-050), but do not become a secrets manager |
| Cloud provisioning execution engines (CloudFormation/ARM/Terraform/Helm runners) | Templates call provider APIs through flows (CMDB-071); no IaC executor |
| ServiceNow API Insights, Service Mapping Plus internals (details unverified) | ITOM-specific and unverified; covered generically by CMDB-058 |
| Compass scorecards and engineering health | Developer-portal domain; generic two-way sync only (SPF-037) |
| Strategic portfolio planning depth (scenario planning, capacity planning, programme management) | Owned by the project/portfolio group; we keep proposals, business cases and links (SPF-017, SPF-032, FIN-028, FIN-045) |
| GDPR records of processing activities | Owned by the privacy part of the security group; supplier side kept as DPA links (SUP-036) |

## Engine requirements

1. **Graph storage and traversal** — typed edge table indexed in both directions; recursive traversal with depth cap, cycle detection and `as_of` effective dating; job-maintained closures (`ci_service_closure`); redundancy-group evaluation; bulk per-node permission post-filter with anonymous placeholders; graph API and a graph widget (layered/force layouts, clustering, lazy loading, accessible table, RTL labels).
2. **Class registry with inheritance** — tables whose rows carry a class discriminator plus jsonb attributes validated against merged inherited field definitions; hot attributes promoted to generated indexed columns; per-class state models, UI policies and health settings; descendant closure; class packs applied as deltas.
3. **Reconciliation write path (IRE)** — identification rules with ordered keys and lookup tables, per-attribute source precedence, refresh rules, attribute locks, provenance rows, advisory locks per identity key, partial payloads and de-duplication task creation — one API for discovery, connectors, imports and integrations.
4. **Import and staging framework** — import sets per source and stage, transform and cleansing rules as records, mapping UI with dry run, scheduled imports, chunked resumable jobs within the worker budget, per-row errors and an AI column-mapping hook.
5. **Connector framework and on-prem collector protocol** — outbound-only HTTPS job leasing, signed jobs and payloads, collector registry with heartbeat and self-update, credentials vault (`secret` fields decryptable only by job identities, external-vault adapters, credential affinity), connector SDK, lane `external` with rate limits.
6. **Condition-language extensions** — `in_query` sub-select operator with caps, jsonb attribute paths, Jalali relative dates; a query AST compiler for the CMDB query language shared with natural-language search.
7. **Snapshots and diffs** — baseline snapshots, diff by reconciliation id, point-in-time reconstruction of records from history.
8. **Ledger primitives** — money type (amount, currency, base amount, rate id), insert-only ledgers with reversal entries, Jalali fiscal periods with locking, immutable runs with input hashes, one fact table for budget/actual/forecast, multi-type exchange rates and price indices, Rial/Toman display.
9. **Quantity and stock primitives** — movement ledger with materialized stock levels, polymorphic check-out table, reservations with expiry.
10. **Pure calculators** — depreciation methods, licence metrics and use rights, allocation, NPV/ROI/payback, service credits; unit-tested, versioned and recorded in each snapshot.
11. **Document extraction pipeline** — Persian-capable OCR, page segmentation, LLM with a strict JSON schema and per-field page/quote evidence, side-by-side review UI, proposals turned into records; runs on the tenant's model, including local models.
12. **Normalization and record-linkage services** — alias tables, regex rules, embedding nearest-neighbour search, LLM adjudication with confidence, review queues learning from decisions, Fellegi–Sunter/logistic scoring, Persian text normalization.
13. **Analytics and ML jobs in code** — STL + robust z-score anomaly detection, seasonal forecasting with Jalali calendar regressors, association-rule mining (relationship suggestions), survival models (failure prediction), clustering (catalogue gaps); the LLM only narrates.
14. **Questionnaire and assessment engine** — shared by TPRM, APM, BIA and surveys: templates, weighted scoring, knock-out questions, external respondents, evidence uploads, Excel import/export.
15. **External persona and portals** — supplier users scoped to their organization and assignments, contract-bound access end dates, journal visibility "shared with supplier", supplier portal pages.
16. **E-bonding framework** — field mapping with ownership, correlation ids, loop prevention, retries, signed inbound webhooks and a message log.
17. **Labels, scanning and Persian PDFs** — barcode/QR/DataMatrix generation, label designer, Persian-shaped PDF rendering (POs, waybills, statements, acknowledgements), camera/USB/RFID scanning in the web, mobile and Windows apps.
18. **Offline sync scopes** — audit sessions, stocktaking drafts and CMDB read replicas in permission-exact sync buckets with merge and conflict rules.
19. **Signatures, OTP and local channels** — drawn signatures and OTP through the generic SMS-HTTP channel (Iranian SMS gateways), Bale/Eitaa/Telegram bot channels for acknowledgements, reminders and approvals.
20. **Field groups and aggregate-only grants** — `financial`, `security`, `personal` and `secret` enforced in projection, filters, sorting, history, notifications, exports, search, vectors, offline replicas and AI; `report_aggregate` with small-cell suppression; reveal-with-reason for secrets logged as privileged actions.
21. **Role-in-context grants and anchors** — service owner (`st:` keys), stockroom manager (`lt:`), budget owner (`cct:`), supplier manager and external supplier users (organization), with re-keying when anchors move.
22. **Scheduled jobs at scale** — nightly health, licence position, depreciation, allocation, scorecards and service scores with idempotent dedupe keys, resumable chunks and debounced recalculation on change events.
23. **AI tools and skills** — graph tools (impact, blast radius, path), NL → query AST for CMDB and assets, insight generators (deterministic query → LLM phrasing), `ai_proposal` records with confidence and evidence, autonomy levels per tool, AI-filled field markers, per-skill model choice (cloud or local).
24. **Calendars** — Jalali fiscal calendars, Iranian public holidays in schedules and deadline computation, business-day shifting of notice dates.
25. **Numbering service** — prefixes used by this group: CI, DUP, FND, VER, CRC, CRT, BSL, DRF, DSC, AST, MDL, TRO, ACK, PRQ, PO, GRN, AUD, RMA, RFR, DSP, ENT, LRN, RCL, VAU, SUB, SVC, OFR, SPR, SDT, CRV, ASM, ADR, ARB, OBJ, ORG, CNT, OBL, GUA, QBR, SCC, DIS, SAS, SRI, EXIT, RFX, MTG, BDG, FCT, ALC, CHB, STM, BC, SAV, INV, ANO, FEX.
26. **Scale targets** — CMDB of at least 2 million CIs × 80 attributes × 5 sources and 10 million relationships per tenant; 100k+ assets; 250 MB imports; impact queries under one second for depth 4 on 10k-node neighbourhoods; licence position for 50k devices within the nightly window.

**Already provided by the platform group (g1).** Several needs above extend existing platform features rather than adding new ones: money field and Rial/Toman display (PLT-003), numbering service (PLT-011), print and PDF layouts (PLT-027), typed record links (PLT-032), business calendars and Iranian holidays (PLT-053), Jalali dates, periods and fiscal year (PLT-054), surveys and assessments engine (PLT-061), import framework (PLT-065), AI-assisted import mapping and document extraction (PLT-066), sync engine and Windows offline replica (PLT-072, PLT-073), translation of record content (PLT-078) and the automated test framework (ADM-017). Items 4, 8, 11, 14, 17, 18, 24 and 25 are specified here only for what this group adds on top of them; items 1–3, 5–7, 9, 10, 12, 13, 15, 16 and 19–23 are new engine capabilities this group requires.
