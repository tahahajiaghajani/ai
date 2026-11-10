# Freshservice (Freshworks) — complete feature catalog

## Overview

**Positioning.** Freshservice is Freshworks' cloud (multi-tenant SaaS) IT service management and enterprise service management product, aimed at mid-market and lower-enterprise IT teams that want ITIL-aligned processes without ServiceNow-level implementation effort. In 2025-2026 Freshworks repositions it as an "AI-powered ServiceOps / employee experience" platform combining ITSM + ITAM (Device42-powered discovery and dependency mapping) + ITOM (alerting, on-call) + PPM-lite (projects) + ESM (workspaces for HR, Facilities, Finance, Legal...) with Freddy AI (Copilot, AI Agent, Insights, and from May 2026 "Freddy AI Agent Studio" and an MCP gateway). Freshservice for MSPs is a separate MSP-mode/edition. Freshservice for Business Teams (FSBT) is the ESM edition for non-IT teams.

**Editions (Freshservice for IT, per agent/month, billed annually, 2026).**

| Plan | USD list (annual / monthly) | UK G-Cloud (Aug 2026) | Headline content |
|---|---|---|---|
| Starter | $19 / $29 | £15 | Workspaces, Incident mgmt, KB, self-service portal, SLA mgmt, Workflow Automator, Orchestration, ServiceBot on MS Teams & Slack, access controls, Analytics Starter, multiple portal languages, custom SSL, marketplace apps, mobile apps, 1,000 orchestration transactions/month |
| Growth | $49 / $59 | £35 | + Service catalog, asset management (100 managed assets), purchase orders, employee onboarding, on-call management, portal customisation, MSP mode, multiple SLAs, business rules, approval workflows, business hours, cloud management, 2,000 orchestration transactions/month |
| Pro | $99 / $119 | £45 (1-100 agents), £41.25 (101-250), £37.50 (251+) | "ITSM + ITOM + Projects": + Problem, Change, Release, Project management, Software license management, Contract management, Major incident management, Status page, Alert management, Service health monitoring, Analytics Pro, team dashboards, IP range restrictions, workload management (intelligent routing by availability & load), custom objects, up to 50 portals, 5,000 orchestration transactions/month |
| Enterprise | custom quote | £57 (1-100), £52.25 (101-250), £47.50 (251+) | + Sandbox, Audit logs, Experience Level Agreements (XLAs), Freddy AI Agent (1,200 sessions/year per license), Freddy AI Insights, 20,000 orchestration transactions/month, (beta in 2026) ServiceBot with Virtual Agent on MS Teams & Slack |

**Add-ons and metering (2026).**
- Freddy AI Copilot — $29/agent/month (UK £14 → £11.50 tiered) on Pro and Enterprise.
- Freddy AI Agent — included in Enterprise as 1,200 sessions/year per agent license (prorated); additional sessions purchasable.
- Orchestration transactions — pack of 1,000 (UK £195; third-party quotes ~$250); every App-node action (and web requests are metered separately with usage alert emails since 2025).
- ITAM module (new packaging for customers signing after 1 April 2026): **Freshservice ITAM Growth / Pro / Enterprise**, priced per pack of 500 **Asset Units (AUs)** (UK £60 / £80 / £100 per 500 AU/month). AU weights: server/VM/network device = 4 AU; desktop/mobile/EUC device = 1 AU; SaaS user = 1 AU; container/function = 0.5 AU; archived device = 1/25 AU; physical non-IP asset = 1/25 AU; storage (per 5 TB discovered) = 1/5 AU; mainframe/mid-range = 400 AU. ITAM Growth: discovery for Windows/Mac/Linux, HAM, lifecycle, CMDB, workflow automation, contracts & POs. ITAM Pro adds network/cloud/storage/infrastructure discovery, agentless + agent-based discovery, SAM, SaaS discovery, software normalisation & enrichment. ITAM Enterprise adds service discovery, application dependency mapping, business service mapping (Device42 technology). Legacy (pre-April-2026) customers keep "asset packs" (500 assets) and the SaaS Management add-on (per employee/month).
- Additional Project Management users (Pro/Enterprise, per user/month; UK £10, third-party ~$15).
- Business agents (ESM agents for non-IT teams, Enterprise only, UK £35/agent/month) — see Freshservice for Business Teams.
- Day passes for occasional agents (UK £2 Starter / £5 Growth / £11 Pro / £14 Enterprise per agent-day; US from ~$3; 3 free at sign-up).
- Onboarding packages (Silver/Gold/Platinum) and Premium Support (20% of monthly contract value, min £2,000/month).
- 14-day free trial with all features.

**Release cadence and naming.** Freshservice is continuously delivered (no version numbers). Freshworks publishes a "What's new" product-updates page, monthly release notes in the support portal, and **Biannual Updates** notices (May and November) for breaking changes: e.g. *Biannual Updates November 2025* (approval groups & chains, ALB IP deprecation → allowlist by domain, sandbox upgrade, analytics fair-usage limits), *May 2026* (approval groups & chains rollout 5 May 2026, sandbox upgrade, analytics usage limits enforced 31 Mar 2026, non-blocking workflow execution for approvals) and *November 2026* (legacy approvals removed 15 Aug 2026, sandbox upgrade/detached sandbox deletion 5 Nov 2026, "Unblock subsequent workflows from pending approvals" setting removed). Major launches are announced at Freshworks' **Refresh** conference (Refresh 2026, May 2026: Freddy AI Agent Studio, MCP gateway) and in spring ITAM launches (2 April 2026: continuous discovery, live dependency mapping, predictive impact analysis, configuration drift detection).

**Late-2026 state.** *Sept 2026 innovation update*: Freddy AI Agent Studio natural-language workflow generation, custom functions, preset triggers, MCP Gateway, Freddy AI Agent for Email, filtered knowledge search, proactive/conversational Copilot with agentic configuration. *Oct-Nov 2026*: Copilot Agent actions with per-action policies, Maintenance Windows and change-notes APIs, Robusta Dev acquisition (AI incident investigation, ~29 Oct 2026). Ticket assignment policies (availability/load/skills) GA from mid-Nov 2025; Journeys launched 30 Jun 2025; ITAM Classic retires Dec 2028 (upgrades through 2026-early 2027).

## Sources

*Platform / automation / admin*
- https://support.freshservice.com/en/support/solutions/articles/232139-create-workflows-using-workflow-automator
- https://support.freshservice.com/support/solutions/folders/273935/page/2 (Workflow Automator article index: web request node, Liquid placeholders, task automations, asset lifecycle, associated-ticket actions)
- https://support.freshservice.com/en/support/solutions/articles/50000011807-workflow-automation-scenarios
- https://support.freshservice.com/support/solutions/articles/50000002961-introducing-orchestration-center
- https://support.freshservice.com/support/solutions/articles/50000003144-orchestration-faqs
- https://freshservice.com/freshservice-orchestration-center-is-now-40-apps-stronger-blog
- https://support.freshservice.com/en/support/solutions/articles/50000011530-intelligent-ticket-assignment-based-on-work-schedule-skills-and-load
- https://support.freshservice.com/en/support/solutions/articles/50000011672-ticket-assignment-policies-framework
- https://community.freshworks.com/how-do-i-11341/load-balancing-availability-24439
- https://support.freshservice.com/support/solutions/articles/50000009712-sync-changes-from-sandbox
- https://support.freshservice.com/en/support/solutions/articles/50000009713-config-sets
- https://support.freshservice.com/en/support/solutions/articles/232444-audit-log

*CMDB / ITAM / procurement*
- https://support.freshservice.com/en/support/solutions/articles/50000012101-freshservice-it-asset-management-itam-upgrade-faq
- https://www.freshworks.com/theworks/company-news/advanced-itam-freshservice-device42/
- https://support.freshservice.com/en/support/solutions/articles/50000010238-managing-it-assets-with-discovery-hub
- https://support.freshservice.com/support/solutions/articles/223633-basic-discovery-tools-and-cloud-discovery-for-it-asset-management
- https://support.freshservice.com/en/support/solutions/articles/50000002810-what-are-the-different-types-of-relationships-in-freshservice-
- https://support.freshservice.com/en/support/solutions/articles/50000003270-what-is-saas-management-
- https://support.freshservice.com/en/support/solutions/articles/50000003281-classifying-managing-and-creating-licenses-for-your-saas-applications
- https://freshservice.com/features/saas-management
- https://support.freshservice.com/support/solutions/articles/50000003221-adding-items-to-inventory
- https://support.freshservice.com/en/support/solutions/articles/50000002755-getting-started-with-purchase-orders
- https://community.freshworks.com/ideas/asset-management-consumables-17275

*Event / ITOM*
- https://support.freshservice.com/en/support/solutions/articles/50000002885-alert-management-in-freshservice-an-overview
- https://support.freshservice.com/en/support/solutions/articles/50000006081-faqs-it-operations-management
- https://support.freshservice.com/en/support/solutions/articles/50000003777-learn-all-about-freshservice-on-call-management
- https://support.freshservice.com/en/support/solutions/articles/50000003776-using-freshservice-on-call-management
- https://support.freshservice.com/en/support/solutions/articles/50000009365-creating-an-on-call-schedule
- https://www.freshworks.com/freshservice/resources/ebooks/major-incident-managment-playbook/

*Project / ESM / portal / workforce / analytics*
- https://support.freshservice.com/en/support/solutions/articles/50000003092-getting-started-with-project-management
- https://www.freshworks.com/freshservice/features/it-project-management/
- https://support.freshservice.com/support/solutions/articles/50000011371-understand-what-journeys-is-and-how-different-departments-use-it
- https://support.freshservice.com/support/solutions/articles/50000011383-create-a-journey-using-a-template
- https://www.freshworks.com/pressrelease/freshworks-launches-freshservice-journeys-to-make-work-life-easier-by-removing-frustration-from-employee-experiences/
- https://support.freshservice.com/en/support/solutions/articles/239003-employee-onboarding-in-freshservice
- https://support.freshservice.com/en/support/solutions/articles/239640-bulk-onboarding-
- https://support.freshservice.com/en/support/solutions/articles/50000009642-onboarding-and-offboarding-dashboards
- https://support.freshservice.com/support/solutions/articles/50000006198-employee-offboarding
- https://support.freshservice.com/support/solutions/articles/50000005699-enabling-requester-actions-for-servicebot-across-plans
- https://support.freshservice.com/en/support/solutions/articles/50000005613-resolve-issues-and-fulfil-requests-on-slack
- https://support.freshservice.com/en/support/solutions/articles/50000003146-resolve-issues-and-fulfill-requests-using-virtual-agent-within-microsoft-teams
- https://support.freshservice.com/en/support/solutions/articles/50000000656-freshservice-integration-with-microsoft-teams
- https://support.freshservice.com/en/support/solutions/articles/183566-improving-it-performance-using-freshservice-arcade
- https://support.freshservice.com/en/support/solutions/articles/50000000545-how-are-the-points-calculated-for-the-leaderboard-
- https://support.freshservice.com/en/support/solutions/articles/50000006341-exporting-tickets
- https://support.freshservice.com/en/support/solutions/articles/50000009919-analytics-usage-limits-in-freshservice
- https://support.freshservice.com/en/support/solutions/articles/238958-scheduled-data-export
- https://support.freshservice.com/support/solutions/articles/50000002911-getting-started-with-the-analytics-platform
- https://support.freshservice.com/en/support/solutions/articles/50000001711-getting-started-with-analytics-basic

*AI*
- https://support.freshservice.com/support/solutions/articles/50000011728-freddy-ai-feature-overview
- https://www.freshworks.com/theworks/company-news/september-2026-freshworks-innovation-update/
- https://itbrief.co.uk/story/freshworks-expands-freddy-ai-with-email-workflows
- https://siliconangle.com/?p=753919 (14 May 2026: Freddy AI Agent Studio and MCP Gateway)
- https://itbrief.com.au/story/freshworks-buys-robusta-dev-to-boost-freshservice-ai
- https://support.freshservice.com/support/solutions/articles/50000009156-freddy-ai-insights-overview (via sibling AI study)
- https://support.freshservice.com/support/solutions/articles/50000010306 (Freddy AI Agent; via sibling AI study)
- https://support.freshservice.com/support/solutions/articles/50000009429-configure-freddy-ai-copilot-features (via sibling AI study)
- https://support.freshservice.com/support/solutions/articles/50000014337-use-the-conversational-copilot-to-resolve-tickets-faster (via sibling AI study)
- https://support.freshservice.com/support/solutions/articles/50000008501-generate-ticket-summaries-using-freddy-ai (via sibling AI study)
- https://support.freshservice.com/support/solutions/articles/50000008514-help-article-generator (via sibling AI study)
- https://www.freshworks.com/freshservice/ai-itsm/

*Access*
- https://support.freshservice.com/en/support/solutions/articles/50000008929 (roles in single/multiple workspaces; via sibling access study)
- https://support.freshservice.com/support/solutions/articles/50000005579-account-admin-guide-access-controls
- https://support.freshservice.com/support/solutions/articles/50000005577-understanding-roles-for-agents
- https://support.freshservice.com/support/solutions/articles/50000003479-use-restricted-groups-to-manage-confidential-and-sensitive-data
- https://support.freshservice.com/en/support/solutions/articles/50000006118 (restricted workspaces)
- https://support.freshservice.com/support/solutions/articles/50000014452-perform-actions-with-copilot-agent
- https://support.freshservice.com/en/support/solutions/articles/50000009519 (Copilot access by role)
- https://www.stitchflow.com/scim/freshservice (third-party SCIM guide)

*Earlier (interrupted) pass — overview, incident, problem, change, release, request, knowledge, slm*
- https://api.freshservice.com/ (API v2 reference: tickets, problems, changes, releases, service catalog, solutions, SLA policies, business hours, groups, CABs, time entries, tasks)
- https://www.freshworks.com/freshservice/pricing/
- Freshservice support articles on Change Lifecycle, CAB Huddle, maintenance/blackout windows, change risk policies, approvals (groups & chains, delegation), XLAs, Major Incident Management/PIR, Biannual Updates (Nov 2025, May 2026, Nov 2026), shared fields and business rules, plus the UK G-Cloud 14 Freshservice listing (Aug 2026) — exact URLs were not recorded before the interruption.

## Module: platform

### Features
- **Workflow Automator (all plans)** — drag-and-drop canvas (Admin > Automation & Productivity > Workflow Automator) for building automations as a flow of nodes. Workflow **types**: *Event Based Workflow* (fires when a record is created/updated) and *Scheduled Workflow* (fires on a time schedule). Target **modules**: Tickets (incidents and service requests), Problems, Changes, Releases, Assets ("Automating Asset Lifecycle"), Tasks ("Task automations"), custom-object records, Journeys/onboarding requests; change workflows can act on **associated tickets** ("Enabling Actions on Associated Tickets in Change Workflows"). Workflows live per workspace (global or workspace level in ESM). Autosave as draft while building; *Save and Activate*; enable/disable toggle; clone whole workflows or individual nodes; ordered list (order matters when two workflows act on the same event, e.g. keyword routing); rules in effect at execution time are applied (tickets raised before an edit keep the old path). [Workflow Automator]
- **Event node** — trigger definition: record raised / updated / raised-or-updated, with "performed by" (agent, requester, system, anyone) and field-change events (status from→to, priority/group/agent changed, note or reply added, approval status changed, requested-item stage changed, etc.). (Exact event list per module partly unverified.) [Workflow Automator]
- **Condition node** — evaluates record, requester and service-item fields (category, source, type, "service request includes item X" with item-field sub-conditions such as cost, request approval status, department, location, VIP, business hours); match ALL/ANY, nested condition groups, **YES/NO branches**; flows cannot loop back or re-join the main flow. [Workflow Automator]
- **Action node** — set/clear fields, assign group/agent, add private/public note, add tag/watcher, send e-mail to requester/agent/group/specific addresses (subject, CC, BCC, body with placeholders), **send approval e-mail to** reporting manager / department head / specific users / agent group / CAB (approval type Everyone / Anyone / Majority / First responder), add tasks to groups, create child tickets, update requested-item stage, update/assign asset, close ticket, trigger **web request**. Multi-stage approvals are chains of "Send approval" actions + "Request Approval is Approved" conditions; since 2025-26 approvals use **approval groups & chains** and are **non-blocking** (pending approvals no longer block later workflows; the "Unblock subsequent workflows from pending approvals" setting is removed in Nov 2026). [Workflow Automator, Biannual updates]
- **Web Request node** — outbound HTTP call (GET/POST/PUT/PATCH/DELETE, headers, auth, JSON body with placeholders) to any REST API incl. Freshservice API v2 itself; response handed to later nodes (usually through a JSON parser); web requests are metered and alert e-mails are sent on usage thresholds (2025). [Web Request Node]
- **JSON Parser node** — parses a JSON payload (from a web request or from App-node outputs such as Google Workspace, Okta, Jira actions); outputs are auto-generated from a sample payload or defined manually with **JSON path** expressions; outputs become placeholders for later nodes. [JSON Parser]
- **Expression Builder node** — computes values with string, math, conditional and date functions and logical/arithmetic operators (e.g. "due date = created + 3 business days", "cost > 1000 and dept = Finance"); declared output type (number, string, date, boolean); used for time-based logic after closure instead of timers. [Expression Builder]
- **Timer node** — pauses a running workflow for a duration (e.g. send reminder 2 days later, delayed escalation), then resumes; not reliable after the ticket is closed (documented caveat). [Timer]
- **App node (Orchestration)** — invokes an action of an installed Orchestration app (e.g. Azure AD/Entra "Get user details by username", "Create user", "Add user to group"; Okta; Google Workspace; Office 365/Exchange; Jira; Slack; AWS; on-prem Active Directory through an orchestration server); each App-node action = **1 orchestration transaction**; outputs feed later nodes. [Orchestration Center]
- **Reader node (custom objects)** — reads one record from a custom object by up to **10 filter conditions** (each dependent-field level counts as one) with sort order, returning the first match; values usable as placeholders (e.g. look up an approver or cost-centre table). Companion actions create/update custom-object records. [Workflow Automator]
- **Placeholders with Liquid filters** — every text field (e-mails, notes, web-request bodies) accepts `{{ticket.*}}`, `{{requester.*}}`, service-item, approval and node-output placeholders, with Liquid filters (upcase, date formatting, default, conditionals, loops). [Placeholders]
- **Execution logs** — per-workflow run history (Admin > Workflow Automator > Execution Logs) showing which nodes fired or failed, node outputs and errors (App-node results "Success" / "Completed with errors"). [Workflow Automator]
- **Workflow templates & generator** — prebuilt templates (onboarding, laptop approval, auto-close, keyword routing, VIP routing) and Freddy **workflow generation** from a natural-language description for admins (see `ai`). [AI]
- **Orchestration Center (all plans, metered)** — catalog of 40+ orchestration apps (identity: Azure AD/Entra ID, Okta, Google Workspace, on-prem AD; collaboration: Office 365/Exchange, Slack, Teams, Zoom; DevOps: Jira, GitHub; cloud: AWS) whose actions are exposed to the App node; customers can build **custom orchestration apps** with the Freshworks Developer Kit (FDK serverless functions declared as actions) (unverified detail). Transaction allowances per month: Starter 1,000 / Growth 2,000 / Pro 5,000 / Enterprise 20,000; packs of 1,000 more; usage alerts at 50%, 80%, 90% and 100%. [Orchestration FAQ]
- **Scenario automations** — agent-triggered macros bundling actions (see `incident`); visibility personal / group / all agents. [Scenario Automations]
- **Supervisor rules** — time-driven rules evaluated **hourly** over open records: time conditions such as hours since created / pending / resolved / due / last requester or agent response, plus field conditions; actions set fields, send e-mails, add notes, escalate; typical uses: auto-close resolved tickets after 48 h, nudge requesters on pending tickets, escalate idle tickets. [Supervisor Rules]
- **Business rules for forms** (Growth+) — client-side form logic on agent forms, portal forms, catalog items and (2026) task forms: show/hide, mandatory/optional, set/clear value, filter options, disable/read-only, validation and confirmation messages; conditions on fields, requester properties and user role. [Business Rules]
- **Field Manager** — per-module form designer (tickets, problems, changes, releases, tasks, assets per asset type, contracts, purchase orders, requesters, agents, departments, locations — module list partly unverified): field types text, paragraph, number, decimal, checkbox, date/date-time, dropdown, multi-select, 3-level dependent dropdown, lookup, URL, content; per-field agent/requester visibility, editability and mandatory-on-submit / mandatory-on-resolve flags; **dynamic sections**; status/priority/source/type value management. [Field Manager]
- **Custom objects** (Pro+) — admin-defined tables (fields text, number, decimal, date, dropdown, checkbox, lookup to users/assets/departments/other records), records managed in UI, CSV import and API (`/objects/{id}/records`); used for workflow reader nodes, service-item lookup fields, approver matrices, cost-centre tables. [Custom Objects]
- **Ticket assignment policies (Pro, Enterprise; GA mid-Nov 2025)** — workspace-level ordered policies (Admin > {Workspace} > Service Management > Ticket Assignment Policies): conditions (Match All/Any) on ticket fields (subject, status, impact…) and requester fields (VIP, service item, department); agent pool "Assign to available agents only" or "Assign to all agents"; optional, reorderable **Load** (fewest open tickets, per-agent load value) and **Skills** (proficiency Expert / Intermediate / Beginner) rankers; **availability is a hard gate** (agent's **work schedule** = shift, active, not out-of-office; with calendar hours a **60-minute "time-left" guard** prevents end-of-shift assignment); load+skill blended by admin weights or skill-first / load-first; ties broken by the **oldest last-assignment timestamp**; *Preview policy* lists matching tickets, eligible agents and the best agent with details. Skills are added manually or **inferred by Freddy ML weekly from six months of history** [AI]; agent profile Skills tab (enable/disable/dissociate). Permissions: Manage Agent Load / Skills / Work Schedules, "Request out-of-office hours for someone else", View/Create/Edit/Delete Assignment Policies. [Assignment Policies]
- **Group round-robin** — per agent group "Automatic ticket assignment" toggle distributes new tickets of the group to members in circular order (classic method, all paid plans; availability-aware variants via the policy framework). [Groups]
- **Unassigned-ticket escalation per group** — e-mail a chosen user when a ticket stays unassigned 30 min – 3 days. [Groups API]
- **Business hours & holidays** — named calendars (time zone, per-day hours, holiday list) linked to groups, SLAs, OLAs and work schedules (see `slm`).
- **Email channel engine** — multiple support mailboxes per workspace (Freshservice-hosted forwarding addresses or custom IMAP/SMTP incl. OAuth for Microsoft 365/Gmail), e-mail-to-ticket with threading, DKIM/SPF setup, per-event notification templates with placeholders for agents, requesters and CCs, agent reply-by-e-mail, keyword-based routing via workflows. [Email Settings]
- **Notifications** — e-mail templates per event (new ticket, assignment, reply, note, status change, SLA reminder/escalation, approval request/reminder, task assignment, change/problem/release events), in-app bell, mobile push, Slack/Teams DMs, SMS/voice for on-call. [Notifications]
- **Global search** — omni-search across tickets, problems, changes, releases, assets, solutions, requesters, agents with filters; type-ahead; keyboard shortcuts. [Search]
- **Import / export** — CSV import (with update-by-key) for requesters, agents, assets/CIs, software, contracts, departments, locations, products, vendors, custom-object records; list exports (CSV/XLSX) of tickets, problems, changes, assets; scheduled data exports and full account export; API v2 for everything else. [Import]
- **Multi-language** — agent UI in ~30+ languages chosen per user; **multiple portal languages on all plans** with translated portal labels, service-catalog items, KB articles and notifications; Freddy translation in tickets and chat. Exact language list and RTL support unverified. [Portal languages]
- **Sandbox** (Enterprise) — a separate configuration copy of production for testing; changes are packaged as **config sets** (≤250 configurations incl. dependencies) and pushed via the **Outward Sync** tab, per workspace (no Global↔IT cross-sync); syncable modules include business hours & SLA policies, asset types, custom objects, service-catalog items, workflows, field manager, business rules (list partial); not syncable: apps, canned responses, supervisor rules, on-call schedules, account settings/audit log; sandbox platform upgraded 2025-26 with detached sandboxes deleted on 5 Nov 2026; change risk policies and Journeys support sandbox sync. [Sandbox, Config Sets]
- **Audit log** — admin/configuration activity (workflows, rules, fields, roles, agents, SLAs, sandbox syncs, restricted-group approvals) with **6-month retention**; filters by workspace, date range, user and "what changed"; export of the preceding 90 days e-mailed to the requesting admin; API access. The plan table lists audit logs as Enterprise while the current article states all plans — conflicting (unverified). Record-level history lives in each record's Activities. [Audit Log]
- **Work calendar** — My Work calendar of tasks, changes, maintenance/blackout windows, CAB meetings and on-call shifts (see `change`).
- **Freshworks platform services** — Freshworks Org/Neo (unified identity and SSO across Freshworks products), Developer Kit (FDK) for custom apps (ticket sidebar, full-page, serverless event and scheduled handlers, key-value and entity storage, secure installation parameters), Marketplace (1,000+ apps), REST API v2 (API-key basic auth, per-plan per-minute rate limits, filter queries, pagination), webhooks via workflow web requests. [Developer Platform]

### Implementation notes
- Represent a workflow as a versioned DAG `{trigger, nodes[{id, type: condition|action|approval|timer|expression|json_parser|web_request|app|reader, config}], edges[{from, to, branch: yes|no|next}]}`; forbid cycles and joins (Freshservice does) so the executor is a simple tree walk with persisted cursor state per run. Store `workflow_version_id` on each run so edits never affect in-flight runs.
- Timer nodes = persisted wake-up jobs (`run_id, resume_at`); on resume re-load the record and re-check that it still exists/is open (Freshservice warns timers after closure are unreliable — define the behaviour explicitly).
- Make every App/Web-request call idempotent and metered: `transaction_log(run_id, node_id, app, action, status, latency, error)`; count against a monthly allowance with threshold notifications (50/80/90/100%).
- Expression and placeholder evaluation needs a sandboxed template language (Liquid-like) with typed outputs; validate expressions at publish time and show the resolved value in execution logs.
- Assignment engine: filter (workspace policy match → active → on shift with ≥60 min left → not OOO) → score (weighted load, skill proficiency) → tie-break by oldest `last_assigned_at`; persist the decision trace for the "Preview policy / Show details" explanation.
- Sandbox = separate tenant cloned from production metadata only; config sets are dependency-resolved bundles of metadata objects with diff + conflict detection on push; keep stable external IDs across tenants.
- Audit log = append-only table (actor, workspace, entity type/id, action, before/after JSON, ip, at) with retention purge job and async export.

## Module: incident

### Features
- **Ticket record (incident / service request)** — one `ticket` entity with `type` = Incident or Service Request (ESM/FSBT workspaces add custom types such as Case, Query, Issue, Request). Display IDs are prefixed (INC-, SR-). Core attributes: requester (`requester_id`/email/phone; unknown e-mail auto-creates a contact), `requested_for` (on behalf of), subject, HTML description, source, status, priority, urgency, impact, group, agent (`responder_id`), department, category → sub-category → item (3-level dependent field), tags, CC / reply-CC / forward e-mails, `email_config_id` (mailbox), `due_by`, `fr_due_by`, `is_escalated`, `fr_escalated`, spam, deleted (trash), `workspace_id`, attachments (≤40 MB per create via API), resolution notes (`resolution_notes`, `resolution_notes_html`), custom fields. Default fields Requester, Subject, Source, Status, Urgency, Impact cannot be deleted. [Freshservice Tickets]
- **Status model** — default statuses Open (2), Pending (3), Resolved (4), Closed (5); admins add custom statuses, each with an agent label, a requester-facing label and an "SLA timer on/off" switch (pending-type statuses pause the SLA clock). Resolved tickets auto-close after a configurable period via supervisor rules. Requester replies can re-open resolved tickets. [Field Manager]
- **Priority, urgency, impact, priority matrix** — priority Low/Medium/High/Urgent (1-4); urgency and impact Low/Medium/High (1-3); an optional **Priority Matrix** computes priority automatically from urgency × impact (admin-editable grid). [Field Manager]
- **Sources (channels)** — enumerated sources: Email (1), Portal (2), Phone (3), Chat (4), Feedback widget (5), Yammer (6), AWS CloudWatch (7), PagerDuty (8), Walk-up (9), Slack (10), Chatbot (11), Workplace (12), Employee Onboarding (13), Alerts (14), MS Teams (15), Employee Offboarding (18); admins can add custom sources (`/ticket_fields/sources`). [Tickets API]
- **Ticket form builder (Field Manager)** — custom field types: single-line text, paragraph, number, decimal, checkbox, dropdown, multi-select dropdown, dependent field (3 levels), date, URL, content (static help text), lookup to users/assets etc. (unverified for every type), rich text and attachment fields (service catalog, 2026). Field properties: mandatory for agents on submit, mandatory on resolve/close, visible to requesters, editable by requesters, mandatory for requesters. **Dynamic sections** show extra fields based on a dropdown value (e.g. category). Per-workspace forms. [Field Manager]
- **Business rules for forms** (Growth+) — no-code rules on agent and portal forms: show/hide fields, make mandatory/optional, set or clear values, filter dropdown options, validations and confirmation messages; evaluated client-side on create/edit; 2026 extension to **task forms** across tickets, changes and problems (task field validation, auto-updates, confirmation messages, task visibility/actions). [Business Rules]
- **Ticket list views** — default views (All, My open, Unassigned, Open, Pending, Resolved, Closed, Watching, Spam, Trash, Raised by me), custom saved views with filters on any field and sorting, card/table layout, column chooser, quick filters, bulk actions (assign, update properties, close, merge, spam, delete, run scenario), export to CSV/XLS. API supports filter queries (`/tickets/filter?query=`). [Tickets]
- **Ticket details page** — conversation timeline (public replies, forwards, private/public notes, @mention to notify agents), activities log (every field change incl. automation-made changes), properties pane, requester info widget (recent tickets, assets), associations (problem, change, release, project, assets, journey request), tasks, time entries, child tickets, approvals, requested items (for SRs), CSAT response, "Collaborate" pane (email, status page, MS Teams/Zoom), watchers, print. [Tickets]
- **Reply tooling** — rich-text editor, canned responses, solution-article insert (insert link or content), attachments from cloud drives, CC/BCC, signature per agent, "send and set status", undo send (unverified), Freddy reply suggestions and writing assistant. [Tickets]
- **Merge tickets** — combine duplicates into a primary ticket; secondary tickets are closed and their conversations/notes are appended to the primary; option to notify requesters. [Tickets]
- **Split ticket** — split a requester reply into a new ticket when it raises a different issue (unverified — inherited from Freshdesk heritage). [Tickets]
- **Parent-child tickets** — create child tickets (incidents or service requests, including cross-type since April 2024) under a parent so different groups can work in parallel; parent shows child status; workflows can wait for/close children; service-catalog bundles can spawn each child item as a separate child SR (`create_child`). Major incidents use child tickets to link affected incidents. [Tickets API]
- **Associations** — link tickets to problems (incident → problem), to changes (initiating/causing change; Freddy "Find initiating changes" ranks changes closed in the last 14 days as likely causes), to releases via changes, to projects, to assets/CIs, to alerts (link/unlink at any time since 2026), and to Journey requests (2026). [Associations]
- **Tasks** — tasks on tickets, problems, changes, releases (and journeys/projects): title, description, status Open / In Progress / Completed / Blocked, agent and group, due date, notify-before reminder, planned start/end and planned effort (calendar), closed_at. Tasks appear in agents' Work Calendar and "My tasks". [Tasks API]
- **Time tracking** — time entries on tickets/problems/changes/releases: agent, start/stop timer (only one running timer per agent across the account), time spent (hh:mm), billable flag (default true), executed-at date, link to task, note; MSP edition adds end time and work type for client billing; timesheet reports in Analytics. [Time Entries]
- **Ticket templates / form templates** — pre-filled ticket forms (subject, description, fields) agents pick when creating tickets; requester-side templates surface as catalog items. [Admin > Form templates]
- **Canned responses** — reusable replies organised in folders, with placeholders (requester name, ticket fields, links), attachments, visibility (personal, all agents, specific groups); insertable into replies/notes; API-managed. [Canned Responses]
- **Scenario automations** — one-click macros that apply a bundle of actions (set fields, assign group/agent, add note, add tag, send e-mail, add watcher, etc.) to a ticket or a bulk selection; visibility personal/group/all. [Scenario Automations]
- **Agent collision detection** — real-time presence showing which agents are viewing or replying on a ticket to avoid duplicate replies. [Tickets]
- **Watchers** — agents follow tickets to be notified on updates; requester CCs receive public updates. [Tickets]
- **Spam and trash** — mark spam (blocks sender), delete to trash with restore and permanent delete. [Tickets]
- **Move ticket across workspaces** — move tickets (and problems/changes/releases) between workspaces or (MSP) clients (`move_workspace`). [Workspaces]
- **Major incident management** (Pro+) — promote an incident to a Major Incident (`/tickets/{id}/promote`, type "Major Incident") or demote it back; major-incident fields such as major incident type (e.g. Partial outage), business impact, impacted locations and number of customers impacted; link affected incidents as child tickets; **Collaborate widget** with stakeholder e-mail (templates with placeholders, banner image, test-send to self), status-page publishing (choose services/groups → "Needs attention", status descriptions, timeline updates), collaboration channels (MS Teams, Zoom; Slack planned); every communication logged in the activity timeline; communications API (`/tickets/{id}/communications`). [Major Incident Management]
- **Post Incident Report (PIR)** — after resolution a PIR widget appears; report templates (custom, enable/disable, set primary, export PDF/DOCX) pre-populated with incident placeholders: observed symptoms, root cause, impact, diagnostic steps, resolution steps, prevention steps, action items; Freddy "Post Incident Report Generator" drafts it from the timeline. [PIR]
- **Major incident AI** — Freddy summarises the incident, drafts communications, generates the PIR; AI-driven correlation of alert/ticket spikes ("connects signals across systems, maps dependencies, coordinates responses"); FireHydrant (acquired Q1 2026) is being folded in as the incident-response/reliability layer (runbooks, structured response, retrospectives). [AI] (partly unverified)
- **SLA timers on tickets** — first-response and resolution due-by computed from SLA policy + business hours; escalation flags; SLA pause on pending statuses; reminder and escalation notifications. (See `slm`.)
- **Satisfaction survey** — CSAT survey sent on resolve/close with rating + questionnaire; response stored on the ticket (`/tickets/{id}/csat_response`). (See `analytics`/`portal`.)
- **Email commands / notifications** — agent, requester and CC notification templates per event (new ticket, reply, status change, assignment, note added, SLA reminders/escalations) with placeholders; agents can reply to notification e-mails to update tickets. [Email Notifications]
- **Freddy on incidents** [AI] — ticket summary, reply suggester (KB-grounded), multilingual reply suggester, writing assistant (tone/clarity/grammar, expand/shorten), translator, similar ticket suggester (English only), sentiment analysis (negative/neutral/positive with trend over the conversation and explanation), resolution insights (likely root cause from similar resolved tickets), resolution-notes generator, field autofill suggester (category/item/group/priority), next-best actions with in-ticket execution and human approval (Oct 2026), conversational "ask me anything" Copilot with citations.

### Implementation notes
- Model one polymorphic `ticket` table with `type` (incident | service_request | custom), `workspace_id`, and numeric enums for status/priority/source to keep reporting simple; display-ID prefixes come from type. Statuses are records (id, agent_label, requester_label, `stop_sla_timer`, category open/pending/resolved/closed).
- Priority matrix = lookup table `(urgency, impact) → priority` evaluated on create/update unless an agent explicitly overrode priority.
- Conversations are an append-only child table (`kind` = reply | note | forward | incoming; `private` flag; `source`; attachments). Activities are a separate audit stream that records field diffs plus the actor (agent, workflow, supervisor rule, API, Freddy).
- Merge = move conversations/attachments/time entries into primary, close secondaries with a system note, keep a `merged_into_id` pointer for redirect and reporting exclusion.
- Parent/child = self-referencing `parent_id`; enforce optional rules (parent cannot resolve while open children exist; auto-resolve parent when all children resolved) via workflow conditions.
- Major incident is a flag + extra fields on the same record plus a `communications` table (channel, template, recipients, payload, sent_at) and a `pir` record (template_id, content_html, status, export). Keep promote/demote auditable.
- Only one running timer per agent: enforce with a partial unique index on `(agent_id) WHERE timer_running`.
- Agent collision needs a presence channel (WebSocket) keyed by ticket ID with "viewing"/"replying" states and short TTL heartbeats.

## Module: problem

### Features
- **Problem record** — PRB- display IDs; fields: requester (initiator), subject, HTML description, status (Open 1, Change Requested 2, Closed 3 + custom statuses), priority (Low–Urgent), impact (Low/Medium/High), group, agent, department, category/sub-category/item, `due_by` (mandatory), **known error** flag ("Is this a known issue?"), assets, custom fields, workspace. [Problems API]
- **Root-cause analysis fields** — dedicated rich-text analysis fields: Root cause (`problem_cause`), Symptoms (`problem_symptom`), Impact (`problem_impact`). [Problems]
- **Solutions: workaround and permanent fix** — "Permanent / Workaround" solution section: link an existing KB article or create a new solution article (title, folder, steps) directly from the problem; KB articles carry `article_type` permanent (1) or workaround (2), which makes the KB a known-error database. [Problems, Solutions API]
- **Known error management** — toggle known error when a workaround exists but a permanent fix is deferred (cost/ROI); known-error articles are surfaced to agents and (optionally) requesters. [Problems]
- **Create problem from incident(s)** — from ticket detail ("Create problem" / associate to existing problem); bulk-associate many incidents; associated incidents tab with link/detach. [Problems]
- **Proactive problem management** — create problems from trend analysis, recurring alert patterns or Freddy Insights root-cause cards. [Problems]
- **Associations** — incidents, changes (raise a change → status "Change Requested"), assets/CIs, projects. [Problems]
- **Tasks, notes (private/public), time entries, activities, restore from trash, move workspace.** [Problems API]
- **Problem notifications and SLAs** — due-by reminders; problem views and filters; problem reports (curated + custom). [Problems]
- **AI for problems** [AI] — Freddy similar-ticket clustering to find candidate problems, resolution insights for root cause, summarisation; Freddy Insights root-cause tree maps (unverified as a direct problem-creation flow).

### Implementation notes
- Problem ↔ incident is many-to-many in practice (an incident links to one problem in the UI); store `problem_incident` join rows with link timestamp and linker.
- Known-error DB = KB articles with `article_type = workaround` linked back to the problem; when the problem closes with a permanent fix, flip or supersede the article.
- Status "Change Requested" should be set automatically when a change is raised from the problem (workflow), and re-opened if the change fails.

## Module: change

### Features
- **Change record** — CHN- IDs; fields: requester (initiator), agent, group, department, subject, description, priority (1-4), impact (1-3), status, **risk** (Low 1 / Medium 2 / High 3 / Very High 4), **change type** (Minor 1, Standard 2, Major 3, Emergency 4; renamable/disable-able in Field Manager), approval status, planned start/end dates, category/sub-category/item, assets, **impacted services**, associated maintenance window, overlapping blackout window (read-only), custom fields, workspace. [Changes API]
- **Change types semantics** — Standard (pre-approved, low risk, no CAB, e.g. OS upgrade), Minor (low impact but full lifecycle incl. CAB), Major (medium/high impact, financial implications, CAB + management approval), Emergency (immediate fix, emergency CAB, review later). [Change Lifecycle]
- **Planning fields** — Reason for change, Impact, Rollout plan, Backout plan (rich text); plus planned dates and planned effort. [Changes]
- **Default statuses** — Open (1), Planning (2), Awaiting Approval (3), Pending Release (4), Pending Review (5), Closed (6); custom statuses via lifecycle. [Changes API]
- **Change Lifecycle builder** (Pro+) — per change type, a state machine of statuses and transitions; transition **conditions**: all tasks complete, requested approvals approved, mandatory fields filled; agents only see statuses reachable from the current one; **lock fields** per status (e.g. freeze rollout plan once in Planning); draft/publish, reorder, view published lifecycle; republishing applies only to new changes (in-flight changes keep the previous version); the lifecycle bar is shown above each change. Permission "Manage Change Lifecycle & Calendar Windows". [Change Lifecycle]
- **Change approvals and CAB** — named **CABs** (members = agents; CRUD API, max 100 members per call); the change manager requests approval from one or more CABs and/or individual approvers; approval rules: Everyone, Anyone, Majority, First responder; multi-level approvals; **approval groups and chains** (2025-2026: several approval groups running in parallel, each with its own rule, plus a chain rule across groups; legacy sequential multi-approval nodes migrated by 15 Aug 2026); approve/reject with remarks from e-mail, web, portal, mobile, Slack/Teams; reminders; **delegation** (out-of-office delegate approves on behalf, one active delegation per user, API since Jan 2026). [Approvals, CAB]
- **CAB Huddle (CAB meetings)** — schedule a CAB meeting from the change calendar with agenda and the list of changes to discuss; "Run meeting" walks through each change for decisions; end meeting → editable summary e-mailed to attendees; sync with Office 365 / Google calendars (those invitees don't get Freshservice e-mails). [CAB Huddle]
- **Change calendar** — Work Calendar (My Work) with day/week/month views, single (agent) or group view, filter changes/tickets/maintenance/blackout/CAB, choose planned dates vs due dates; hover preview; on-call calendar alongside. [Calendar]
- **Maintenance windows** — name, description, duration, optional daily/weekly recurrence with end, **conditions** ("available for changes that match…"), **freeze window** toggle (stop adding changes), associate changes (auto-sets planned start/end), mismatch error when a change does not satisfy conditions; publish maintenance to the status page; alerts for assets under maintenance are suppressed (2024); Maintenance Windows API (Nov 2026). [Maintenance Windows]
- **Blackout windows** — name, description, duration, recurrence, conditions ("apply to changes that match…"); changes whose planned dates overlap show the blackout window (read-only `blackout_window` attribute) and can be stopped by lifecycle/business rules (enforcement mode not documented — unverified hard block). [Blackout Windows]
- **Change risk policies** (Pro+, 2026) — global or per-workspace policies with Match ALL/ANY conditions on change properties, planning fields or calendar data; a policy applies a **risk profile** (parameter-based scoring: e.g. priority, maintenance-window association, blackout overlap, documentation completeness; each rule operator/value → score 0-10; optional weights summing to 100), a **risk survey** (questionnaire answered on the change form: multichoice, long text, rating scale, yes/no, message; up to 50 questions; scored answers, weights, multi-language, branching; created from scratch, duplicated or **generated by Freddy AI**), or both combined by **highest severity** or **weighted average** (e.g. 70/30). Score → configurable risk levels (e.g. Low 0-25, Medium 26-50, High 51-75, Very High 76-100) shown in the sidebar and overriding the Risk field; re-evaluated on every update, stops at Closed; first matching policy in drag-and-drop order wins; drafts/publish/toggle; sandbox sync; "Basic Risk Awareness" signals when no policy matches; risk-aware change business rules (Q3 2026). Marketplace "Risk Assessment for Change" app offers a simpler questionnaire with thresholds. [Change Risk Policies] [AI]
- **Change associations** — initiated-by tickets/problems, related incidents, releases, assets/CIs and impacted services (CMDB impact analysis), projects. [Changes]
- **Change from other records** — create a change from an incident, problem or service request; standard changes can be offered as catalog items / templates (form templates). [Changes]
- **Tasks, notes (private/public notes on changes via API since Nov 2026), time entries, activities, move workspace.** [Changes API]
- **Change views and filtering** — predefined views, advanced query filtering, sorting and pagination (Nov 2024 API), list/calendar toggle. [Changes]
- **Status page for maintenance** — publish scheduled maintenance from a change or maintenance window to status pages with publishable services and timeline updates. [Status Page]
- **Change AI** [AI] — Similar Change Suggester (recent similar changes on change details, with feedback), Find Initiating Changes (rank changes closed in last 14 days by likelihood of causing an incident), change recommendations, AI-generated risk surveys, CMDB-based impact visibility (business service mapping) in the new ITAM.

### Implementation notes
- Lifecycle = versioned definition `{change_type, version, statuses[], transitions[{from, to, conditions[]}], locked_fields_by_status}`; each change stores `lifecycle_version_id` at creation so republishing never breaks in-flight records. Status dropdown is computed from outgoing transitions; conditions evaluate tasks (all closed), approvals (all groups approved per chain rule) and field completeness.
- Approval engine: `approval_group(rule: everyone|anyone|majority|first_responder, level)` → `approval(approver_id, status requested|approved|rejected|cancelled, delegatee_id, remark)`; a chain rule decides how group outcomes combine; delegation resolves approver at send time and records `delegatee`.
- Calendar windows: store windows with RRULE-like recurrence and a condition tree (same condition DSL as workflows). Overlap check = interval intersection between change planned window and expanded window occurrences; cache expansions per month.
- Risk engine: deterministic scoring function over profile rules + survey answers → 0-100 → bucket; persist the breakdown for audit; re-run on every update until Closed; first-match policy selection.

## Module: release

### Features
- **Release record** — RLS- IDs; fields: subject, description, release type (Minor 1, Standard 2, Major 3, Emergency 4), status (Open 1, On Hold 2, In Progress 3, Incomplete 4, Completed 5 + custom), priority (1-4), agent, group, department, category/sub-category/item, planned start/end dates, **work start/end dates** (actuals), assets, custom fields, workspace. [Releases API]
- **Release planning fields** — Build plan and Test plan (rich text). [Releases]
- **Associated changes** — a release bundles one or more changes (`associated_change`); release progress tracked through change and task completion. [Releases]
- **Tasks, notes, time entries, activities, restore, move workspace.** [Releases API]
- **Release views** — filters all, my open, unassigned, completed, incomplete, deleted; release reports in Analytics. [Releases]
- **Release in the calendar** — release tasks show on the work calendar; releases appear as parents of tasks (release-level calendar entries not documented — unverified). [Calendar]
- **DevOps hooks** — releases are typically fed from Jira/Azure DevOps/GitHub via marketplace apps and workflow web requests (see `devops`).

### Implementation notes
- Release is a thin container over changes: derive `status` hints from the set of linked changes (all closed → suggest Completed) but keep status manual or workflow-driven.
- Keep planned vs actual windows separately to report schedule variance.

## Module: request

### Features
- **Service catalog structure** (Growth+) — per-workspace catalog: root categories with up to two levels of sub-categories (3 levels), custom or A-Z ordering, global category sort; deleting a category deletes its sub-categories and items; portal shows the catalog grouped by workspace (workspace order = creation order). [Service Catalog]
- **Service item definition** — name, category, short and detailed description, icon/image, cost (with "visible in portal"), estimated delivery time in hours (with "visible in portal"), quantity (`allow_quantity`), attachments allowed, **Requested-for** option ("Allow requester to request for someone else", role-permission gated), draft (1) / published (2) state, clone, move to category, change status, delete; `display_id`; "bot ready" flag (`botified`) so the item can be ordered through ServiceBot/Freddy AI Agent. [Service Item API]
- **Item types** — normal (1) and **loaner** (2): loaner items require From/To date-time and integrate with asset "loaner" usage type; items can be mapped to a **product / asset type** (hardware, consumables, software; "Devices" replaces "Hardware/Consumables" for ITAM signups after 31 Mar 2026) so fulfilment can allocate inventory. [Service Item API]
- **Item form builder** — drag-and-drop custom fields (single line, paragraph, number, decimal, checkbox, dropdown, multi-select, date (optionally with time), lookup, content blocks, rich text and attachment fields since Apr 2026) with field limits (e.g. text+dropdown ≤ 50, checkboxes ≤ 25 per item); **lookup fields** sourcing values from custom objects or locations, with hierarchical dependent behaviour; **shared fields** (Aug 2025) reused across items/categories in a workspace with archive/unarchive; per-field properties (mandatory, requester can edit, agent-only, validation rules). [Service Catalog, Shared Fields]
- **Business rules for service items** — show/hide/mandatory/read-only/disable on load/set value rules on the request form (e.g. make a field read-only by enabling "Requester can edit" then a rule to disable it). [Business Rules for Forms]
- **Bundles / additional items** — attach other catalog items as additional items (optional or mandatory) to a main item (`is_bundle`, `child_items`); choose **"Create child requests for each of the items above"** to spawn linked child tickets each routed to its own group with its own SLA, or keep one SR handled by one agent; not available for loaner items. [Service Catalog]
- **Visibility** — item visible to all requesters or restricted to requester groups (`group_visibility`), agent-visibility vs requester-visibility; agent workspace visibilities; MSP: applicable clients (`applicable_to_workspace_ids`). [Service Catalog]
- **Subject template** — "Compose Service Request Subject" with static text + placeholders (item fields, requester). [Service Catalog]
- **Requested items on the ticket** — an SR carries `requested_items[]`: quantity, stage (**Requested, Delivered, Cancelled, Fulfilled, Partially Fulfilled**), loaned flag, cost per request, remarks, delivery time, parent flag, item custom-field values, attachments; agents can update stage/quantity; additional items can be added to an existing SR (API Jan 2026). [Service Request API]
- **Approvals** — approval workflows built in Workflow Automator (event "Service request is raised" + item condition → "Send approval email" to reporting manager, department head, specific users, groups, CAB): approval types Everyone / Anyone / Majority / First responder; multi-level hierarchical approvals (manager → IT head); approval groups + chain rules (2025-26); approve/reject via e-mail links, portal "Approvals" tab, mobile app, Slack/Teams; approval e-mail template placeholders `{{ticket.service_item_fields}}`, `{{ticket.request_summary}}`; reminders (`/approvals/{id}/remind`); delegation of approvals (time-boxed). [Approvals]
- **Fulfilment** — workflows add tasks to groups (procurement, IT ops), create child tickets, call Orchestration apps (create AD/Entra/Okta/Google user, add to group, provision licence), update assets (assign laptop, loaner check-out), update stage, and close the SR when tasks complete; OLA policies time the tasks. [Workflow Automator]
- **Request channels** — portal catalog (search, categories, popular/recent items), ServiceBot in Slack/Teams (bot-ready items), Freddy AI Agent formless ordering, agent-raised SR on behalf of a requester, e-mail (as incident then converted), API `place_request`. [Portal, ServiceBot]
- **Service request SLAs** — SLA policies can target ticket type = Service Request, specific service items or categories. [SLA Policies]
- **Employee lifecycle requests** — onboarding/offboarding requests (legacy Employee Onboarding/Offboarding modules) and Journeys (see `esm`).

### Implementation notes
- Model `service_item` (versioned form schema JSON + fulfilment config) and `requested_item` rows attached to an SR ticket; keep item form values in a typed EAV or JSONB with a schema version so later form edits do not corrupt historical requests.
- Bundle expansion: on submit, create parent SR + child SRs (if `create_child`) in one transaction; propagate requester/requested-for and link via `parent_id`.
- Requested-for vs requester: store both; approvals and visibility use requested-for (e.g. manager of the person who will get the laptop) while notifications go to both.
- Stage roll-up: SR resolved only when every requested item is Delivered/Fulfilled/Cancelled; Partially Fulfilled if mixed.

## Module: knowledge

### Features
- **Hierarchy** — Solution **categories** → **folders** → (sub-folders) → **articles**, per workspace; default folders (e.g. drafts) are system-managed. [Solutions API]
- **Folder visibility** — All users, Logged-in users, Agents only, Departments (ESM), Agent groups, Contact/requester groups; MSP: applicable clients; folders can be **managed by** specific agent groups (`manage_by_group_ids`). [Solution Folder API]
- **Article model** — title, rich-text body (images, tables, code, embedded video), article type **permanent (1) / workaround (2)**, status **draft (1) / published (2)**, approval status (requested/approved/rejected), tags, **keywords** (search boosting/SEO), attachments (≤40 MB), external URL articles (link-only), **review date** (reminder to the owner; reported to revert the article to draft when reached), author, views, thumbs-up/down, position, workspace. [Solution Article API]
- **Approval workflow** — folder-level approval settings with approvers and mode **All approvers** or **Anyone can approve/reject**; non-approver authors submit drafts for approval (`send_for_approval`); approvers approve, reject or send feedback; author revises and resubmits; published only after approval. [KB Approvals]
- **Version history** — each save creates a version; view and restore previous versions (approval/publisher metadata of old versions not shown — community request 2026); marketplace "Version History – Solution Articles" app adds diffs. [KB]
- **Trash** — categories, folders and articles go to trash; restore, bulk restore, delete forever (Mar 2026). [Solutions API]
- **Multilingual KB** — portal languages and article translations per language (multiple portal languages on all plans); Freddy translation for agents. [Portal languages]
- **Knowledge in the agent workflow** — insert article link/content into replies, suggested articles beside tickets (Knowledge Content Recommendations [AI]), create article from a ticket/resolution ("Help Article Generator" drafts from tickets and public sources [AI]), problem → known-error articles. [KB, Freddy Copilot]
- **Self-service deflection** — portal search with type-ahead and suggested articles while the requester types a ticket subject; article feedback (helpful / not helpful with comment, can create a ticket); popular articles; Freddy AI Agent answers from articles with source citations [AI]. [Portal]
- **External knowledge connectors for AI** — SharePoint, Google Drive, Confluence, URLs (crawl parent links, up to 3,000 child links each) and uploaded files feed Freddy AI Agent/Agent Studio; **SharePoint sync insights** (2026) show site status, item counts, file-level failures with reasons and CSV error export; filtered knowledge search per agent (Sept 2026). [AI Agent Studio]
- **KB reporting** — article views, votes, feedback, AI-agent usage of articles, Copilot article-generation usage reports. [Analytics]

### Implementation notes
- Store article versions as immutable rows (`article_version`: body, metadata, author, created_at, approval snapshot) and point `article.current_version_id` / `published_version_id` separately so drafts never affect the published copy.
- Visibility check = folder visibility evaluated against the viewer (role, departments, agent groups, requester groups, workspace) — reuse the same predicate for search indexing (index ACL tokens per article) and for AI retrieval so the AI agent never cites an article the user cannot open.
- Review-date job: daily scan; notify owner N days before; optional auto-unpublish.

## Module: cmdb

### Features
- **Unified asset/CI repository** — Freshservice does not separate "assets" and "CIs": every asset record (hardware, software installation, service, cloud resource, document, custom type) is a CI in the CMDB, and the CMDB is included from Starter-era "asset" features upward (ITAM Growth+ in the 2026 packaging). Records carry a `display_id`, asset tag, name, description, asset type, impact (Low/Medium/High), usage type (Permanent / Loaner), state, location, department, managed by (agent), managed-by group, used by (requester), assigned on, product, vendor, cost, acquisition date, warranty expiry, end of life, discovery source and last-audit timestamps, plus type-specific attributes. [Assets API]
- **Asset type hierarchy (CI classes)** — tree of asset types with attribute inheritance from parent to child: Hardware (Computer → Desktop, Laptop, Server; Mobile device; Printer; Monitor; Network → Router, Switch, Firewall, Access point, Load balancer; Storage; Data-center → Rack, PDU, UPS), Software, Services (Business Service, IT Service, Sales/Support Service), Cloud (AWS / Azure / GCP resource types such as EC2 instance, VPC, S3 bucket, RDS, Azure VM, GCP VM), Consumables, Documents, Others (exact default tree partly unverified). Admins add custom asset types and type-specific fields (text, number, date, dropdown, lookup, etc.). For ITAM sign-ups after 31 Mar 2026, "Devices" replaces the "Hardware/Consumables" split. [Asset Types]
- **Components** — discovered sub-records per device: processor, memory, disk/logical drive, network adapter, graphics card, peripherals; installed software list with versions and install dates. [Assets]
- **Relationship types** — pairs of upstream/downstream labels; defaults include Used By ↔ Depends On, Runs ↔ Runs on, Hosts ↔ Hosted On, Connected to ↔ Connected to, Sends data to ↔ Receives data from, Exchanges data with (symmetric), Impacts ↔ Impacted by, Supports ↔ Supported by, Managed by ↔ Manages, Owned By ↔ Uses, Virtualizes ↔ Virtualized by, Backed Up by, Includes ↔ Member of, Contains ↔ In Rack, Houses ↔ Located In, Subscribed by ↔ Subscribes to, Enables ↔ Is enabled by, Are part of ↔ Consists of, Attached to ↔ Contains, Written By ↔ Author of, Is Edited by ↔ Editor, Submits ↔ Submitted by; custom types = a name + an inverse name (Admin > (Global Settings >) Asset Management > Relationship Types). Relationships can link **assets, requesters/agents, departments and locations**. [Relationship Types]
- **Relationship map** — interactive graph on each CI showing upstream and downstream relationships over several levels, used for impact analysis from incidents and changes (impacted services) and, in the 2026 ITAM, **live dependency mapping** and **predictive impact analysis** (Device42-powered service/application dependency mapping, affinity groups, business service maps). Bulk relationship create/delete via API (async job with status). [CMDB, ITAM 2026]
- **Service CIs and impacted services** — business/IT service CIs link to changes ("impacted services"), major incidents (impacted services/status page) and service health monitoring (see `event`).
- **Reconciliation and data quality** — discovered data matched to existing CIs by identifiers (serial number, UUID, MAC, hostname — exact rules unverified); Device42 **Automated Reconciliation** in Advanced discovery; 2026 **configuration drift detection** flags changes from a known baseline. [Discovery Hub, ITAM 2026]
- **CI views and search** — asset list views with filters on any attribute, saved views, column chooser, bulk update/delete/associate, import from CSV (create or update by asset tag/ID), export, trash/restore. [Assets]
- **CI association to ITSM records** — assets attach to tickets, problems, changes, releases, projects and contracts; requester widget shows a user's assets; the asset page lists associated requests, problems, changes, contracts, software and relationships ("Asset 360"). [Assets]
- **Audit/history** — per-asset activity stream of every attribute change with actor (agent, discovery source, workflow, API). [Assets]

### Implementation notes
- Single `asset` table with `asset_type_id` + JSONB `type_fields` validated against the type's inherited schema; keep the type tree in a closure table for "all descendants of Hardware" queries.
- Relationships as `ci_relationship(source_type, source_id, target_type, target_id, relationship_type_id)` where `relationship_type` holds both labels; render downstream vs upstream by direction. Impact analysis = bounded BFS (depth limit, cycle guard) over "impacting" relationship types only.
- Reconciliation: identification rules ordered by priority (serial+manufacturer → UUID → MAC → hostname+domain), source precedence per attribute (e.g. MDM wins for OS, Device42 wins for dependencies), and a staging table of unmatched/duplicate candidates for manual merge.
- Drift detection: snapshot selected attributes per CI on approval/baseline; diff on each discovery run; raise a drift record or alert when a monitored attribute changes outside an approved change window.

## Module: itam

### Features
- **Packaging (2026)** — new sign-ups from 1 Apr 2026 buy **ITAM Growth / Pro / Enterprise** priced in Asset Units (see Overview); **ITAM Classic** (asset packs) is retired in **December 2028** with upgrades rolling out through 2026 and early 2027, no disruption to existing workflows/data, AU billing from first renewal. [ITAM upgrade FAQ]
- **Discovery Hub** (Admin > Global Settings > Asset Management > Discovery Hub) — one console with tabs **Basic, Advanced, Integrations, Cloud, SaaS**. [Discovery Hub]
  - *Basic (Freshservice-powered)*: **Discovery Agent** (lightweight agent for Windows, macOS and Linux; continuous updates in real time, keeps reporting when a laptop leaves the network; mass deployment via GPO/SCCM/Intune/Jamf — deployment tooling partly unverified) and the agentless **Discovery Probe** (Windows server application; *Standard Probe* scans IP ranges over **WMI, SSH and SNMP**, connects to **Active Directory** to import users/computers, and to **Microsoft SCCM** to import devices; scheduled scans with stored credentials).
  - *Advanced (Device42-powered)*: all Basic features plus **Application Dependency Mapping**, **Cloud Recommendation Engine** (right-sizing/migration), **Automated Reconciliation**, network/storage/hypervisor/container/mainframe discovery; set up via the Device42 **Main Appliance** + **Remote Collector** (on-prem virtual appliances), install the "Device42 for Freshservice" app with domain, cloud connector, verification token and a default approver; "Compare Basic and Advanced" view; trial licence.
  - *Integrations*: MDM/endpoint sources — Microsoft Intune, Automox, VMware Workspace ONE (AirWatch), Jamf, Kandji, Lansweeper and more (beyond the first three, unverified).
  - *Cloud*: AWS Cloud Management, Azure Cloud Discovery, Google Cloud Discovery (cloud resources become CIs; EC2 orchestration actions e.g. start/stop instances).
  - *SaaS*: orchestration-based connectors for Google Workspace, Zoom, Slack, Dropbox, Microsoft 365, Okta etc.
- **2026 ITAM launch (2 Apr 2026)** — continuous discovery, live dependency mapping, predictive impact analysis ("what breaks if this changes") and configuration drift detection in the CMDB (Device42 technology; tier = ITAM Pro/Enterprise per AU editions). [ITAM 2026] [AI-assisted, partly unverified]
- **Hardware asset management** — full lifecycle: plan (product catalog) → procure (PO) → receive (convert PO lines to assets / add to inventory) → deploy (assign to user, department, location; loaner check-out) → maintain (contracts, warranties, tickets) → retire/dispose (state change, disposal tasks). Asset states typically In Use, In Stock, In Repair/Maintenance, Missing, Retired, Disposed (custom states via Field Manager; exact defaults unverified); usage type **Permanent or Loaner**; warranty and end-of-life dates with expiry notifications; lifecycle automation via the Workflow Automator ("Automating Asset Lifecycle"). [Assets]
- **Product catalog** — products (models) with asset type, manufacturer, status (In Production / In Pipeline / Retired), mode of procurement (Buy / Lease / Both), **depreciation type**, description and vendor price lists (vendor, cost, warranty, quantity); products drive POs, catalog items and inventory mapping. [Products API]
- **Depreciation** — per product/asset depreciation method (straight line, declining balance, double declining balance, sum-of-years-digits — method list partly unverified), useful life and salvage value; current book value on the asset and in reports. [Products]
- **Loaner management** — loaner usage type + loaner catalog items with From/To dates; check-out/check-in through SR fulfilment; overdue reminders via workflows. [Service Catalog]
- **Inventory** — stock of hardware and consumables per product (and location); **"Add to Inventory"** from a purchase order in *Partially Received* or *Received* state (hardware and consumable types only; products must be mapped to inventory items); catalog fulfilment decrements stock. Stockroom check-out and reorder thresholds are not documented (unverified / gap). [Inventory]
- **Software asset management** (ITAM Pro / legacy Pro) — software catalog built from discovery (agents, probe, MDM, SaaS connectors) with application type (**desktop, SaaS, mobile**), publisher, category, versions, status (**managed / ignored / restricted (blacklisted)**), managed by; **installations** (device, path, version, install date, user); **users** (for SaaS: first/last used, source); **licenses** linked to software-licence contracts with license type and counts → **compliance** (compliant, under-licensed, over-licensed); restricted-software detection; **normalisation & enrichment** of titles/publishers (Device42-based in ITAM Pro). [Software API]
- **SaaS Management** (legacy add-on per employee/month with 14-day trial; included in ITAM Pro from 2026) — discovers SaaS apps through IdP/SSO and direct connectors (Okta, Google Workspace, Microsoft 365/Entra, Slack, Zoom, Dropbox…); 360° view of **usage and spend**; **SaaS Insights** flag redundant and under-utilised apps and per-user activity; **license reclamation**; renewal reminders and auto-renewal tracking on licences; SaaS apps are CIs relatable to users, devices and services. [SaaS Management]
- **Contract management** (Pro+) — contract types **Lease, Maintenance, Software License, Warranty** + custom types with custom fields; fields: name, number, vendor, approver, start/end date, cost, **billing cycle** (one-time, monthly, quarterly, half-yearly, annual), **item cost details** (line items: name, per-unit or fixed pricing, cost, count), license type and key (software), auto-renew flag, **expiry notifications** N days before to chosen users, visibility, associated assets and software; statuses Draft → Pending approval → Approved/Rejected → Active → Expired/Terminated; **approval** by a designated approver (with delegation); **renewal** creates a linked future contract and history; Contract Manager role. [Contracts API]
- **Purchase orders** (Growth+) — PO number/name, vendor, expected delivery date, department, currency, billing & shipping addresses, line items (item type, product, cost, quantity, tax %), discount %, tax %, shipping cost, totals, terms; statuses **Open → Ordered → Partially Received → Received**, plus **Cancelled** and approval states; send for approval; e-mail the PO (PDF) to the vendor; **receive items** → convert to assets (asset tags, serials) or add to inventory; link POs to the service requests they fulfil; Procurement Manager role. [Purchase Orders]
- **Vendors** — vendor directory (contact, address, phone, e-mail, website) linked to products, contracts, POs and assets. [Vendors API]
- **Mobile asset scanning** — mobile app barcode/QR scanning to look up, audit and update assets; printable asset tags. [Mobile]
- **Asset reports** — curated asset inventory, assets by type/state/location, warranty and contract expiry, software compliance, depreciation; custom asset reports in Analytics. [Analytics]

### Implementation notes
- Discovery ingestion: normalise payloads from agent/probe/MDM/cloud into a staging schema (`source, source_key, observed_at, attributes`), run identification + reconciliation, then upsert CIs and components; keep per-attribute provenance (`source, last_seen`). Mark CIs "stale" when no source has reported for N days.
- Asset Units metering = Σ(weight(asset class) × count) computed nightly from the CMDB (server/VM 4, desktop/mobile 1, SaaS user 1, container 0.5, archived 1/25, non-IP physical 1/25, storage 1/5 per 5 TB, mainframe 400) — model weights as config.
- Licence compliance = per software: entitlements (sum of licence counts by metric: per user/per device/volume/site) vs consumption (installations or active users, de-duplicated); classify per publisher/product family after normalisation; store a daily snapshot for trend reports.
- PO receive flow: per line track `ordered_qty, received_qty`; status derives from the sum; "convert to assets" creates N asset rows pre-filled from the product with a mandatory serial/asset-tag grid; inventory rows keyed `(product_id, location_id)` with movement ledger (`receive, issue, return, adjust`).
- Contracts: expiry and renewal jobs; renewal clones the contract with `previous_contract_id`; approval reuses the shared approval engine.

## Module: slm

### Features
- **SLA policies** — multiple policies (Growth+; one default policy on Starter) ordered by position; first matching policy applies; conditions (`applicable_to`) on ticket type, service items, service categories, departments, groups, sources, category/sub-category/item and on requester fields (`evaluate_on` ticket / requester; MSP also client fields) with match ANY/ALL. Each policy has **targets per priority** (Urgent/High/Medium/Low): first-response-within and resolve-within (seconds/minutes/hours/days), **business hours vs calendar hours** per target, escalation enabled flag. [SLA Policies API]
- **SLA escalations** — first-response escalation (one level) and **resolution escalations up to multiple levels** (typically 4); each with when = before breach / immediately at breach / after breach, an offset time, and recipients (specific agents, groups, or the assigned agent `-1`). Escalation sets `is_escalated` / `fr_escalated` flags and sends notifications. [SLA Policies API]
- **SLA reminders** — reminder notifications to the assigned agent before first-response/resolution due. [Email notifications]
- **SLA clock behaviour** — clocks pause in statuses whose "SLA timer" is off (e.g. Pending, Awaiting vendor); due dates recomputed on priority/policy changes; resolution due-by shown on tickets ("Due by", "FR due by"), overdue flags and views. [SLA]
- **Business hours** (Growth+ for multiple) — named calendars with time zone, working hours per weekday (or 24×7), **holiday lists** (yearly dates), default calendar; assigned to groups (global or workspace-level business hours) and used by SLA/OLA, timers, assignment policies and agent work schedules. [Business Hours API]
- **OLA policies (tasks)** — internal agreements for collaborating teams: OLA policies set the Due-By of **tasks** matching criteria (Admin > Service Desk Settings > SLA and OLA Policies), with response/resolution targets, escalations and cloning; tasks inherit business hours. [OLA]
- **Group unassigned escalation** — per group, e-mail a chosen user if a ticket stays unassigned for 30m/1h/2h/4h/8h/12h/1d/2d/3d. [Groups API]
- **Experience Level Agreements (XLAs)** (Enterprise, GA mid-2026) — XLA policies (global or workspace) with ALL/ANY conditions on ticket fields (status, urgency, priority, type) and requester fields (department, location, VIP), "import conditions from SLA", templates (VIP user, Major incidents, Service request) or from scratch; three **themes** with weights totalling 100%: **Service Reliability** (resolution time vs SLA target), **Service Quality** (first reply time, update frequency, reopen rate, reassignment rate, resolution note) and **Requester Effort** (requester updates, number of requester responses); each rule adds deductions or rewards; **score = 100 − Σ(theme weight × deductions) + Σ(theme weight × rewards)**, clamped 0-100; bands Poor 0-25, Average 26-50, Good 51-90, Excellent 91-100 (configurable); live score in the ticket sidebar, list view and Analytics; **threshold escalations** (level 1 warning, optional level 2) to agents/supervisors/groups while the ticket is open; policy preview with per-ticket breakdown and "pro tips"; top-down policy order; a default global XLA policy acts as fallback. Marketing describes "weighted computation and AI analysis" linking performance to employee sentiment. [XLA] [AI]
- **Contract/vendor underpinning** — vendor contracts with expiry notifications support UC tracking (see `supplier`).
- **SLA reporting** — curated SLA reports (first response / resolution SLA compliance, breaches by group/agent/priority), Freddy Insights cards on SLA violations. [Analytics]

### Implementation notes
- SLA engine: on create/update compute `fr_due_by`/`due_by` = business-calendar add(target, start, calendar, holidays); store an SLA timeline of pause/resume intervals keyed by status category so recomputation is deterministic; escalations are scheduled jobs keyed by (ticket, level) and cancelled/re-planned on every relevant change.
- Policy matching is ordered first-match; persist `sla_policy_id` and the target snapshot on the ticket for audit.
- XLA: event-sourced counters per ticket (agent public updates, reassignments, reopenings, requester responses, first-reply time) → recompute score on each event; persist the theme breakdown; escalate on threshold crossing once per level.

## Module: service_portfolio

### Features
- **Service definitions** — business and IT services are CIs (Services asset types) with relationships to supporting CIs, used for impact analysis, impacted services on changes/major incidents, service health and the status page; the employee-facing **service catalog** is separate (see `request`). No formal service portfolio lifecycle (pipeline / catalog / retired), service owners' scorecards or service costing (gap).

### Implementation notes
- Link `business_service` CIs to catalog items and SLAs/XLAs so service-level reporting can aggregate incidents, requests, changes and experience scores per service.

## Module: event

### Features
- **Alert Management (Pro+)** — ITOps/NOC console that ingests notifications from monitoring tools through **webhooks** (out-of-the-box integrations with a "growing list" of tools such as AWS CloudWatch, Azure Monitor, Datadog, New Relic, Nagios, Zabbix, PRTG, SolarWinds, Dynatrace, Prometheus/Grafana, Site24x7, Pingdom — specific list partly unverified — plus a generic custom-webhook integration and **e-mail alerts** with **regex extraction** of grouping values). Payloads are normalised and **severity values mapped** to Freshservice severities. [Alert Management]
- **Alert record** — Alert ID, subject/message, severity, resource, metric, node, status (open/resolved), last-updated time, tags, raw payload, occurrence count and the associated incident; the **Resource** field is the primary key for mapping an alert to an asset/CI. Alerts list (left-nav Alerts icon) with filters on created date, severity, resource, suppression status and more. [Alert Management, ITOM FAQ]
- **Deduplication & grouping** — notifications grouped by default on *resource name + metric name*; custom integrations may group on any combination of **Resource, Metric, Message, Node**; e-mail alerts group on regex-extracted values (previously only identical subjects). [Alert Management]
- **Freddy ML alert correlation** [AI] — Freddy learns historical patterns between alerts and the incidents they were linked to and **automatically attaches new alerts to open incidents** (automated grouping/noise reduction; needs a sufficient volume of resources and alerts); agents can manually attach an alert to an open incident, which also trains the model; alerts from multiple devices can roll up into one incident, which **resolves only when all associated alerts resolve**; alerts can be linked/unlinked from incidents at any time (2026). [Alert Management]
- **Alert Workflows (alert rules)** — a dedicated automator with **nested if-then-else rules**; triggers on alert created/updated (e.g. severity changes to X, status changes); actions create an incident with fields and assignment to agents/groups, auto-resolve incidents when alerts clear, notify on-call (alert workflows without tickets were roadmap in 2023). [Alert Management]
- **Maintenance suppression** — alerts for assets under an active **maintenance window** are suppressed (2024); suppression status is filterable. [Maintenance Windows]
- **Service Health Monitoring (Pro+)** — services discovered from an alert payload attribute ("**Potential Services**", optional regex — e.g. resource `bookings-database` → service *Bookings Database*), service maps and dependencies, service status (**Operational / Needs Attention**, set automatically when an alert creates an incident; manual override reverts when a new alert incident arrives); services feed major-incident "impacted services" and the **status page**. [ITOM FAQ]
- **On-Call Management (Growth+)** — four pillars: **on-call schedules** (per agent group, per location, or both), **shifts** (time-of-week and/or geography based, time zones), **rotations** (daily, weekly, monthly or custom periods, spreading nights/weekends/holidays), **escalation policies** (conditions on ticket fields — priority, status, urgency, impact, category — and up to **5 escalation levels**, stopping when the incident is acknowledged or resolved; a policy can be applied to any shift), **overrides** for a shift when availability changes, and an **on-call calendar** (also in the Work Calendar). Notification channels: e-mail, **SMS** (region-dependent), **phone call** (agent phone numbers in E.164 format; downloadable **VCF** contact so phones recognise on-call calls), mobile-app push, Slack, **WhatsApp**, and Microsoft Teams DM via ServiceBot; on-call notifications usable in major-incident management. [On-Call Management]
- **Alerts reporting** — curated *Alerts* report (alerts and incidents created in the last 30 days, top noisy resources) and custom alert reports. [Analytics]
- **Incident-response layer (2026)** — FireHydrant (acquired Q1 2026) adds runbooks, structured incident response, status updates and retrospectives (integration depth unverified). [FireHydrant]

### Implementation notes
- Ingestion endpoint per integration with a mapping config (JSONPath for resource/metric/message/node/severity/status + severity map); compute `dedup_key = hash(selected fields)`; open alert per key with occurrence counter; a "resolve" payload closes it.
- Correlation: start rule-based (same resource/service within a time window, CMDB neighbours) and add a learned model using historical (alert features → linked incident) pairs; each manual attach is a labelled example; keep a confidence threshold and show the reason.
- Incident ↔ alerts is one-to-many; incident auto-resolve when `count(open alerts) = 0` (configurable).
- On-call: schedule = layers of rotations (participants, rotation length, handoff time, restrictions by weekday/time) + overrides; resolve "who is on call at t" by evaluating overrides first, then layers; escalation engine = per-incident timers per level cancelled on acknowledge; notification dispatch with retries and per-channel delivery receipts.

## Module: continuity

### Features
- **Availability signals** — service health monitoring statuses, status page, major-incident management, maintenance and blackout windows (see `event`, `change`, `portal`).
- **Capacity hints** — Device42 Cloud Recommendation Engine (right-sizing/migration recommendations) in Advanced discovery. [Discovery Hub]
- No capacity/performance management or IT service continuity (BCP/DR) planning modules (gap).

### Implementation notes
- A continuity module would add service-level BIA (RTO/RPO per business service CI), DR plans with tests, and capacity thresholds fed from monitoring metrics.

## Module: security

### Features
- **Platform security & compliance** — Freshworks trust programme (SOC 2 Type II, ISO 27001-family, GDPR; HIPAA support — unverified per plan), encryption in transit and at rest, regional data residency, IP range restrictions, SSO/SCIM, audit log, restricted groups/workspaces for confidential HR/legal cases, GDPR requester erasure. [Security]
- **No SecOps / vulnerability response / GRC module** — security incidents are handled as ordinary tickets in a (restricted) workspace; vulnerability-scanner and SIEM integrations come from the marketplace (gap vs. ServiceNow SecOps/IRM). (unverified integration list)

### Implementation notes
- If exceeding Freshservice, add a security-incident record type with restricted visibility by default, vulnerability items linked to CIs, and policy/control/risk registers.

## Module: supplier

### Features
- **Vendor directory** — vendors (contact name, e-mail, phone, address, website, description) linked to products (price lists), assets, contracts and purchase orders; vendor-wise spend via contract/PO reports. [Vendors]
- **Vendor contracts** — maintenance, lease, warranty and software-licence contracts with costs, billing cycles, renewal and expiry notifications act as underpinning contracts behind SLAs (see `itam`).
- **Vendor-facing collaboration** — forward tickets / e-mail vendors from the ticket, "Awaiting vendor" style custom pending statuses that pause SLA; no dedicated supplier portal or vendor performance scorecards (gap). [Tickets]

### Implementation notes
- Keep vendor as a first-class entity referenced by product, contract, PO and asset; add SLA-like vendor KPIs (on-time delivery from PO expected vs received dates, contract renewals) if exceeding Freshservice.

## Module: financial

### Features
- **Asset cost & depreciation** — acquisition cost, depreciation method, useful life, salvage and book value per asset (see `itam`).
- **Contract and PO spend** — contract cost, billing cycles and line items; PO totals with tax, discount and shipping; currency per PO. [Contracts, Purchase Orders]
- **Service-item cost** — catalog items carry a cost shown on the portal and stored per requested item (`cost_per_request`), usable in approval conditions (e.g. > $1,000 needs IT-head approval). [Service Catalog]
- **Time tracking and billing** — billable time entries on tickets/problems/changes/releases/projects; MSP mode adds work types and client billing exports. [Time Entries]
- **SaaS spend** — SaaS Management spend views and renewal tracking. [SaaS Management]
- No chargeback/showback, budgets or cost models (gap vs. ServiceNow/BMC). 

### Implementation notes
- Store money as `(amount_minor, currency)`; compute depreciation schedules on demand from method + life + salvage; aggregate spend by vendor, department and cost centre (custom object) for showback.

## Module: project

### Features
- **New-gen Project Management (Pro, Enterprise; extra project-only licences sold separately)** — Freshrelease-derived project workspace inside Freshservice (lineage unverified); project roles **Project Manager** and **Project Member**; projects created blank, **from a template**, or **from a ticket, problem or change**. [Project Management]
- **Project templates** — reusable project skeletons with predefined task lists and deliverables (save any project as a template). [Project Management]
- **Methodologies** — agile, waterfall or hybrid; agile projects have **roadmap, backlog, sprints and versions**; waterfall projects use timelines/milestones. [Project Management]
- **Views** — the same task set as **Timeline (Gantt)**, **Kanban** board, **task list** and **grouped** views, with filters and saved views. [Project Management]
- **Configurable work items** — custom **task types** (e.g. epic, story, task, sub-task, milestone), custom **statuses** and custom **fields** per project; assignees, due dates, priority, estimates, attachments, comments, @mentions, activity history; task hierarchy and (unverified) task dependencies. [Project Management]
- **ITSM linkage** — associate tickets, problems, changes and assets with projects and project tasks; Workflow Automator actions **create a project or project task** from service-desk triggers (e.g. a change of type Major spawns a project). [Project Management]
- **Collaboration** — contextual collaboration via **Slack** (messages sync both ways; Nov 2025) and notifications; DevOps integrations with **GitHub and GitLab** (commits/PRs linked to tasks). [Project Management]
- **Project analytics** — consolidated view of projects across teams (progress, workload, overdue tasks, sprint burndown — specifics unverified) plus project reports in Analytics. [Project Management]
- **Legacy projects** — the earlier "classic" project module (projects with tasks, milestones and Gantt) is superseded by new-gen projects. (unverified detail)
- No portfolio/demand/resource-capacity planning or financial project tracking (no full PPM; gap vs. ServiceNow SPM). 

### Implementation notes
- Model `project(type: agile|waterfall|hybrid, template_id)` → `work_item(type_id, parent_id, status_id, sprint_id, version_id, start, due, estimate)` with per-project type/status/field schemas; sprints and versions as separate entities; Gantt needs dependencies (`work_item_link(from, to, type FS/SS/FF/SF, lag)`).
- Link table `project_record_link(project_id|work_item_id, record_type, record_id)` for tickets/problems/changes/assets; workflow actions call the same service as the UI.

## Module: workforce

### Features
- **Work schedules (shifts)** — per-agent work schedule (days, hours, time zone; bulk "Update work schedules"); used by assignment policies (availability gate, 60-minute end-of-shift guard) and calendar-hour SLAs; **out-of-office** requests (agents request OOO; supervisors can request OOO for someone else) remove agents from assignment. [Assignment Policies]
- **Agent load and skills** — per-agent load value and skill proficiency (Expert/Intermediate/Beginner), manual or **Freddy-inferred skills** [AI]; used for load- and skill-based routing (see `platform`).
- **Workload management (Pro+)** — supervisor view of agents' assigned tickets/tasks/changes with **planned effort** and planned start/end on a timeline to balance load and reassign (exact UI unverified); custom "Workload" module privilege in roles. [Workload]
- **On-call shifts and rotations** — see `event`.
- **Occasional agents & day passes** — occasional agents consume **day passes** (bought per plan; 3 free at sign-up) only on days they log in; full-time agents hold seats. [Agents]
- **Time tracking & timesheets** — timers and time entries on records/tasks/projects, billable flag, timesheet reports (see `incident`).
- **Gamification — Arcade / Leaderboard** — enable under Admin > Automation & Productivity > Agent Productivity > Leaderboard; **points** per activity (e.g. fast resolution, first-contact resolution, positive CSAT; admin-defined values, penalties for late resolution — penalty detail unverified), **levels** with point thresholds and automatic promotion, **quests** (default + custom: type, point value, badge; big bonus + profile badge on completion), monthly **trophies** (Most Valuable Player — most points; Speed Racer — most tickets resolved fast; Customer Wow Champion — highest satisfaction points; sources list 2-4 trophies), monthly leaderboard on the dashboard. [Arcade, Leaderboard]
- **No native WFM forecasting/scheduling optimisation** (gap vs. Zendesk WFM, ServiceNow Workforce Optimization).

### Implementation notes
- Availability = schedule occurrences (RRULE per agent + holidays) minus OOO intervals; precompute "on shift until" for routing.
- Gamification is an event-sourced point ledger (`agent_id, event, points, rule_id, at`) with monthly windows for leaderboard/trophies and lifetime totals for levels; quests are rule counters with deadlines.

## Module: portal

### Features
- **Employee self-service portal (all plans)** — single portal across all workspaces (catalog and KB grouped by workspace): global search with type-ahead (articles, catalog items), **service catalog**, **knowledge base**, "Report an issue" ticket form (with suggested articles while typing), **My tickets / My requests** (and department/company tickets for requesters allowed to see them), **Approvals** tab, announcements banner, service-status link, popular/recent items, CSAT survey responses, requested-for ordering, Freddy AI Agent chat (Enterprise) [AI]. Requesters can reply, add attachments, close/reopen per settings and track requested-item stages. [Portal]
- **Portal access settings** — open sign-up vs invite-only, allowed domains, SSO-only login, requester password policy, "requesters can see tickets of their department / company" (prime users), portal URL on a custom domain with **custom SSL** (all plans). [Portal settings]
- **Portal customisation (Growth+)** — logo, favicon, colours/theme, header/footer, landing-page layout; HTML/CSS page customisation; **multiple portals (up to 50 on Pro)** for brands/clients (exact per-plan limits partly unverified). [Portal customisation]
- **Portal languages (all plans)** — multiple portal languages with translated labels, catalog items, KB articles and notification templates; the requester picks a language or it follows profile/browser. [Portal languages]
- **E-mail channel** — any number of support mailboxes per workspace; e-mail creates tickets, replies thread into them; Freddy **Email Bot** (AI Agent on e-mail) detects intent and replies with answers or forms before an agent picks the ticket up [AI]. [Email, AI Agent]
- **ServiceBot for Slack and Microsoft Teams (Starter+)** — requesters raise tickets in chat (raise-a-ticket button, thumbs-down or ticket emoji opens a form that **Freddy pre-fills from the conversation** [AI]), search solutions, order **bot-ready catalog items** (ServiceBot picks the item from the message; falls back to a ticket), get status-change notifications and **approve requests** (Slack Home tab "Approvals"; Teams approvers need not be agents); agents get new-ticket notifications (Freshservice **groups mapped to Slack channels**; Teams DMs/group pushes), reply to and update tickets, collaborate on incidents; requester actions are no longer Enterprise-only; on-call notifications via Teams DM. Install: Admin → Apps (Slack) or Admin → Channels (Teams). The legacy Virtual Agent was deprecated 21 May 2025 in favour of Freddy AI Agent; "ServiceBot with Virtual Agent" is a 2026 Enterprise beta. [ServiceBot]
- **Freddy AI Agent channels (Enterprise)** — portal widget, Slack, Teams (via ServiceBot), Email Bot and **Microsoft 365 Copilot**; formless intent capture, multi-turn context, cited answers, image (screenshot) understanding, catalog ordering and ticket creation/status (see `ai`). [AI]
- **Mobile apps (all plans)** — Freshservice iOS/Android app: agents work tickets/problems/changes, approve, get push notifications, respond to on-call pages, scan asset barcodes/QR codes; requesters raise and track tickets, browse catalog/KB and approve requests (requester-side scope partly unverified). [Mobile]
- **Other intake sources** — phone (Freshcaller/Freshworks Contact Center integration, source = Phone), chat, **feedback widget** (embeddable web widget), **walk-up** (in-person IT bar tickets), Yammer/Workplace (legacy social), alerts, onboarding/offboarding, API, custom sources (see `incident` source list). [Tickets]
- **Announcements (all plans)** — title, rich-text body, visibility (agents only, or agents + requesters; specific agent groups, departments or requester groups), active-from / active-till scheduling (states scheduled / active / archived), optional e-mail to the audience, banner on the portal and agent home; announcement privileges are workspace-scoped; API. [Announcements]
- **Status page (Pro+)** — internal/public status page fed by major incidents ("Collaborate" widget: choose services/service groups, statuses such as *Needs attention*, status descriptions, timeline updates), maintenance windows and changes (scheduled maintenance), and service-health monitoring; service groups and publishable services. Subscriber notifications and custom domain are unverified. [Status Page]
- **CSAT surveys** — configurable satisfaction survey (rating scale + questions) sent on resolve/close, answered from e-mail or portal; results on the ticket and in reports. [Surveys]

### Implementation notes
- Portal = read model filtered by the requester's visibility (workspace membership not required; catalog/KB visibility by requester group/department, restricted workspaces excluded only for agent data); compute a per-user "visible catalog" cache invalidated on group/department changes.
- Chat channels should call the same request/ticket services as the portal; store `source` and the conversation transcript; approvals from chat must verify the approver identity mapping (Slack/Teams user ↔ Freshservice user by e-mail) before applying.
- Announcements: `audience` rules evaluated at read time; schedule via `active_from/active_till`; optional fan-out e-mail job.

## Module: esm

### Features
- **Workspaces (multi-workspace ESM, all plans)** — account = **Global** settings (users, departments, locations, roles, asset management, discovery, relationship types, account-wide admins) + **workspaces** (IT and business workspaces such as HR, Facilities, Finance, Legal, Marketing, Procurement or custom) each with its own agents and groups, ticket types/forms/fields/statuses, service catalog, KB, SLAs/OLAs, workflows, mailboxes, business hours, reports and portal section; workspace templates per department; workspace states (*in setup* → active; items in setup are visible only to members); **restricted workspaces** (only explicitly added agents/admins — even account admins are excluded); **Workspace Admin** role; move tickets/problems/changes/releases between workspaces; unified employee portal. Department workspaces may rename ticket types (Case, Query, Issue, Request). [Workspaces]
- **Freshservice for Business Teams (FSBT)** — ESM edition/agent type for non-IT teams: **business agents** (Enterprise add-on, UK £35/agent/month) and **Business Supervisor / Business Agent** roles with a reduced feature set (tickets, catalog, KB, automations, analytics; no problem/change/release/asset management); Freddy AI Copilot available as an add-on for FSBT. [FSBT]
- **Journeys (launched 30 Jun 2025)** — designer for **multi-department workflows** (HR onboarding/offboarding/promotions, IT provisioning/access, Facilities relocation, Finance reimbursements/budgets, Legal NDAs/contract reviews): **prebuilt templates** (journey type set by the template for filtering/analysis), **phases → triggers → activities** (tasks, forms, approvals, cross-workspace requests) with automated task hand-offs to the right stakeholders at the right time, reminders, **real-time progress tracking** across departments, built-in **SLA adherence/accountability**; journey requests can be associated with tickets (2026); sandbox-syncable. [Journeys]
- **Employee Onboarding & Offboarding (legacy, Growth+)** — onboarding request with an **Initiator form** (HR enters new-hire data, joining date, department, manager) and **Stakeholder forms** (IT, Facilities, etc.) that become child tickets per stakeholder group; offboarding uses an initiator form; ticket sources Employee Onboarding (13) / Offboarding (18); **bulk onboarding from CSV** (one request per candidate, e-mails to employee and manager); onboarding/offboarding **dashboards** (initiators see their own requests; supervisors with permission see all) and reports; only Pro/Enterprise agents administer onboarding; business agents have limited features. [Employee Onboarding]
- **MSP mode / Freshservice for MSPs (Growth+)** — **clients (companies)** as the top-level tenant within one account: client field on tickets and other modules, client contacts and client-specific **SLAs** (`evaluate_on` client fields), catalog/KB **applicable clients**, move tickets between clients, client-wise views and reports, time entries with end time and **work type** for client billing, per-client portals/branding (unverified); Freddy AI Agent Studio is **not available in MSP mode**. [MSP mode]
- **Department heads and prime users** — department head approvals for department requests and requester visibility of department tickets (see `access`).

### Implementation notes
- Implement workspaces as a mandatory `workspace_id` partition on every operational table with a separate global scope for people/CMDB; every config object is either global or workspace-scoped (forms, catalogs, SLAs, workflows, reports). Restricted workspace = explicit allow-list check that overrides account-admin grants.
- Journeys: model `journey_template(phases[{activities[{type, owner_rule, form, offset_from_key_date, depends_on}]}])` and `journey_instance` with an activity scheduler driven by the key date (e.g. start date − 5 days); activities create tickets/tasks in the owning workspace and roll status up to the journey.
- MSP: add `client_id` as a second partition key for data and configuration applicability; never share requester identities across clients.

## Module: csm

### Features
- **Internal focus** — Freshservice targets employees; external customer service is **Freshdesk** (same vendor), integrated so customer-support agents can escalate customer tickets to IT in Freshservice and track the linked status (Freshdesk–Freshservice integration). **MSP mode** serves external client organisations of service providers (see `esm`). Field service management lives in Freshdesk, not Freshservice. [Integrations]

### Implementation notes
- If one product must serve both, reuse the ticket engine with an `audience` (employee | customer | client) dimension and separate portals, SLAs and visibility rules.

## Module: analytics

### Features
- **Analytics platform (Freshworks Analytics)** — Analytics *Starter/Basic* = curated reports only (with export); **Analytics Pro (Pro+)** = custom reports, team dashboards and advanced filters. [Analytics]
- **Curated reports** — prebuilt reports for ticket overview/volume and trends, SLA compliance (first response/resolution), agent and group performance, CSAT, problems, changes, releases, assets (inventory, warranty), contracts, alerts (alerts vs incidents, noisiest resources), time sheets, onboarding/offboarding, Freddy AI Agent overview and Copilot usage. [Analytics]
- **Custom reports** — report = set of **widgets**; each widget picks a module/metric (tickets, problems, changes, releases, tasks, assets, software, contracts, purchase orders, projects, time entries, alerts, approvals, CSAT, XLA, journeys — module list partly unverified), aggregation, group-by, filters and visualisation (bar/column, line, area, pie/donut, table, pivot, KPI/number); drill-down to the underlying records; private or shared with agents/groups. [Analytics]
- **Dashboards** — default agent/supervisor dashboards (ticket counts by status, SLA, trends, to-dos, announcements, leaderboard) and **custom team dashboards (Pro+)** built from report widgets. [Dashboards]
- **Scheduled reports & exports** — schedule a report to be e-mailed (PDF/CSV) daily/weekly/monthly; export reports; **scheduled data export** sends recurring module data as a downloadable file or **API URL** for BI tools; list-view exports; API. [Scheduled Data Export]
- **Usage limits** — analytics fair-usage limits (report data range/volume vary by plan) enforced from **31 Mar 2026**. [Analytics usage limits]
- **Freddy AI Insights (Enterprise)** [AI] — proactive insight cards on ticket volume, resolution time, first-response time, SLA violations (by category/agent) and survey score; insight types *Majority, Outliers, Trend change (spike/fall), Longest increase/decrease, Recent change, Overall trend*; each with criticality colour, trend chart and a **root-cause tree map** ("Leading causes could be…") plus natural-language summary; refresh daily (30-day look-back), weekly (12 weeks, needs 6 weeks of data) or monthly (1 year, needs 6 months); governed by a *Freddy Insights* role permission. [Freddy AI Insights]
- **Report permissions** — "Manage ticket reports" with assigned-items scope is elevated to workspace scope but shows only tickets the agent can see; private reports of deactivated agents are deleted. [Roles]

### Implementation notes
- Build analytics on a separate read store (CDC from OLTP into a columnar warehouse) so heavy reports do not hit transactional tables; apply the viewer's row-level scope (workspace, group scope, restricted groups) as mandatory predicates in every query and in scheduled-report execution (run as the report owner, re-checking permissions at send time).
- Insights: per metric time series by dimension (category, group, agent); detect majority (share > threshold), outliers (robust z-score/MAD), trend change (change-point detection), longest run of increase/decrease; root-cause tree = contribution analysis of the delta by dimension values; LLM writes the summary from the computed facts only.

## Module: ai

### Features
- **Packaging** — **Freddy AI Copilot** = add-on ($29/agent/month) on Pro and Enterprise (and FSBT), licensed per agent and **enabled per role** (admins choose which Copilot capabilities each role gets); **Freddy AI Agent** = Enterprise, 1,200 sessions per licence per year (session = one unique user within 24 h), extra sessions purchasable; **Freddy AI Insights** = Enterprise; **Freddy AI Agent Studio** = Growth/Pro/Enterprise from 14 May 2026 (free until 31 Dec 2026; not in MSP mode); some features ship first through the Freshworks Early Access programme. Third-party sources sometimes claim "Freddy only on Enterprise" — conflicting (unverified). [Freddy AI overview, Pricing]
- **Copilot — Response assistant** [AI] — *Reply Suggester* (drafts a reply grounded in the ticket and KB), *Multilingual Reply Suggester* (drafts in the requester's language), *Writing Assistant* (rephrase, fix tone/clarity/grammar, expand, shorten). [Copilot]
- **Copilot — Summarization assistant** [AI] — *Ticket Summariser* (on demand; auto-generated on close only when the conversation has >1 message, SRs excluded), *Resolution Notes Generator*, *Post Incident Report Generator* (structured PIR from creation to resolution), *Test Case Generator* (test cases from issue context). [Copilot]
- **Copilot — Resolution assistant** [AI] — *Similar Incident Suggester* (English only), *Resolution insights* (likely root cause + fix steps from similar resolved tickets), *Intelligent Related Changes* / *Find Initiating Changes* (ranks changes closed in the last 14 days as likely causes, link in one click), *Similar Change Suggester* on change records. [Copilot]
- **Copilot — Ticket assistant** [AI] — *Field Autofill Suggester* (category/sub-category/item, group, priority, type), *Translator* (ticket content to the agent's language and back), *Sentiment analysis* (Negative / Neutral / Positive with trend over the conversation and an explanation). [Copilot]
- **Copilot — Knowledge assistant** [AI] — *Help Article Generator* (drafts KB articles from ticket context or from a topic using public sources: KB → New article → enter a topic), *Knowledge Content Recommendations* (relevant articles while troubleshooting). [Copilot]
- **Conversational Copilot** [AI] — "ask me anything" side panel on a record with cited answers from KB and history; follow-up questions; **proactive insights** (Sept 2026: surfaces relevant articles and historical tickets without a prompt); **agentic configuration** (admins write instructions that set how Copilot behaves and what it prioritises). [Conversational Copilot, Sept 2026 update]
- **Copilot Agent actions / next-best actions** [AI] — Copilot recommends and executes actions inside the ticket (update fields, assign, run app actions such as resetting a password through an integrated app) after human approval; Copilot checks the agent's own permissions before recommending and before executing; per-action policy **Always allowed / Approval required / Blocked** (customising single actions turns the app setting into "Custom"); actions limited to the app's default groups or per-action groups; newly added app actions arrive **unmapped (safe)**; some actions always require extra confirmation (Oct-Nov 2026). [Copilot Agent]
- **Multimodality** [AI] — *Image Support*: extracts information from screenshots/images attached to tickets or chats; Sept 2026 improved file and image understanding. [Freddy AI overview]
- **Freddy AI Agent (employee-facing, Enterprise)** [AI] — channels **portal, Slack, Microsoft Teams (ServiceBot), Email Bot, Microsoft 365 Copilot**; *multilingual*, *multi-turn*, **formless conversations** (captures intent and fields without forms), *actionable response summaries*, **citations and grounding**; **enterprise search** over the Freshservice KB, **SharePoint** (sync insights: site status, item counts, file-level failures, CSV error export), **Google Drive**, **Confluence**, URLs (crawl up to 3,000 child links) and uploaded files; **filtered search** restricting knowledge sources per agent/request type (Sept 2026); orders bot-ready catalog items, raises/pre-fills tickets, reports ticket status, hands off to humans; **Freddy AI Agent for Email** holds multi-reply agentic conversations until resolution (Sept 2026); *Freddy AI Agent overview* report; legacy Virtual Agent deprecated 21 May 2025. [Freddy AI Agent]
- **Freddy AI Agent Studio (14 May 2026, Refresh 2026)** [AI] — no-code builder for task-specific AI agents for IT, HR, Finance etc.: agent instructions, knowledge sources, **agent workflows** (actions through Freshservice workflows and ~30 out-of-the-box integrations), **natural-language workflow generation** (admin describes process, outcome and actions → executable workflow logic, validated before adding to an agent; Sept 2026), **custom functions**, **preset workflow triggers**, richer in-workflow interactions (forms, confirmations); RBAC via the "Manage AI Agent Studio" role permission. [AI Agent Studio]
- **MCP Gateway (May 2026)** [AI] — Model Context Protocol endpoint that lets external AI tools/assistants and third-party systems use live Freshservice service context and actions (setup per support article; scopes unverified). [MCP Gateway]
- **Freddy AI Insights (Enterprise)** [AI] — *Proactive Insights with Root Cause Analysis*, *Customized Insights*, *Conversational Insights* (ask analytics questions in natural language); insight types and refresh cadence in `analytics`. [Freddy AI Insights]
- **Freddy for admins** [AI] — natural-language workflow generation (Agent Studio), AI-generated **change risk surveys**, Copilot agentic configuration; a "service item generator" for the catalog could not be confirmed (unverified).
- **Change risk AI** [AI] — risk survey generation by Freddy, "Basic Risk Awareness" signals, risk-aware business rules (see `change`).
- **Alert/incident correlation** [AI] — Freddy ML attaches alerts to open incidents from learned alert↔incident patterns (see `event`); marketing claims Freddy correlation cuts alert noise ~65% and flags weak signals early. **Automatic major-incident detection** from ticket spikes is **not confirmed** as a shipped feature (unverified).
- **AI routing** [AI] — weekly ML skill inference (six-month look-back) feeding skill-based assignment policies; precision/skill-based routing (see `platform`).
- **XLA AI analysis** [AI] — XLA scores combine experience signals; marketing mentions AI analysis linking performance to sentiment (see `slm`).
- **ITAM AI** [AI] — predictive impact analysis and configuration-drift detection in the 2026 ITAM (AI involvement partly unverified).
- **Acquisitions feeding AI (2026)** — FireHydrant (incident response; Q1 2026, unverified) and **Robusta Dev** (acquired ~29 Oct 2026: AI incident investigation — AI root-cause analysis, pre-populated incident timelines, suggested runbooks; ship dates not announced). [IT Brief]
- **AI usage reporting** — Freddy AI Agent overview report, Copilot usage/article-generation reports, session metering. [Analytics]

### Implementation notes
- Every Copilot feature is a prompt template over a **permission-filtered context** (the record, its conversation, linked KB articles the agent may read); never pull data the viewer cannot see. Log prompt, retrieved sources and output per invocation for audit and usage billing.
- Similar-ticket and related-change features: embeddings on subject+description+resolution with metadata filters (workspace, time window such as "changes closed in last 14 days", CI overlap); rank by vector score × structural signals (shared CI/service, time proximity).
- Agent actions: tool registry entries `{action, required_permission, risk, policy: always|approval|blocked, allowed_groups}`; new tools default to *unmapped/blocked*; execution re-checks permissions server-side at run time.
- AI Agent sessions: meter one session per unique user per 24 h; enforce quotas with alerts.
- Retrieval from SharePoint/Drive/Confluence must carry source ACLs (or restrict to publicly shared spaces) — Freshservice does not document ACL propagation (risk to address).

## Module: access

### Features
- **Agent roles vs admin roles** — agent roles grant privileges per module (Tickets, Problems, Changes, Releases, Assets, Announcements, Solutions, Reports and module privileges for Alerts, Inventory, Contracts, Purchase Orders, Onboarding/Offboarding, Projects, Workload); admin roles grant View / Edit / Delete / Manage per settings area (e.g. Workflow Automator, Field Manager, SLA, Change Lifecycle & Calendar Windows, Assignment Policies, AI Agent Studio, Freddy Insights); a user holding several roles gets the union (highest access). [Roles]
- **Scope per privilege** — each agent privilege carries its own scope: *across all groups / the whole workspace* (unassigned + non-restricted groups), *member and observer groups*, *specific groups*, or *assigned items only*; un-scopable privileges (e.g. creating announcements, managing reports) are elevated to workspace scope while still showing only data the agent can see. [Roles]
- **Built-in roles** — Account Admin (billing, subscription, workspaces; sees no data unless also given an agent role; no access to restricted workspaces), Workspace Admin (implies IT Supervisor), IT Supervisor, Business Supervisor, IT Agent, Business Agent, Problem Manager, Change Manager, Release Manager, Configuration Manager (CMDB), Contract Manager, Procurement Manager, IT Ops Agent (alerts), Project Manager, Project Member; custom roles. [Roles]
- **Global vs workspace scopes** — admin permissions are granted **account-wide** or **workspace-wide**; agent permissions exist only inside a workspace; account-wide admins are auto-added to non-restricted workspaces; workspaces *in setup* show published items only to members; **restricted workspaces** admit only explicitly added agents/admins (account admins lose access) while published service items and solution articles are not hidden by the restriction. [Workspaces]
- **Agent groups** — members, **observers** (view, no edit) and **leaders** (≥1 per group); business hours, round-robin auto-assignment, unassigned escalation, approval-group use; **restricted groups** hide their tickets from everyone else (including workspace-wide agents and department-wide requesters), optional **group-leader approval** for adding agents, granting leadership, disabling restriction/approval and deleting the group (first leader response wins; delegation does not apply; logged in the audit log), identity assumption of restricted-group agents blocked; deleting the group unassigns its tickets; applies to tickets only (not problems/changes/releases/projects). [Restricted groups]
- **Requester groups** — manual or rule-based groups used for service-item and KB-folder visibility and approvals. [Requester groups]
- **Departments and department heads** — requesters belong to one or more departments (companies in MSP mode); the **department head** is an approver target; **prime users** ("can see all tickets from associated departments/companies") see department tickets in the portal. [User management]
- **Locations** — hierarchical locations (parent → child, e.g. country → city → building/floor) with address and primary contact; used on users, assets, on-call schedules, conditions and catalog lookups. [Locations]
- **Requester and agent profiles** — name, e-mails (primary + secondary), phones, job title, **reporting manager** (approval target), departments, location, time zone, language, **VIP** flag, custom fields; convert requester ↔ agent, merge requesters, deactivate, forget (GDPR erasure). Agents: full-time vs **occasional** (day passes), business agents, signature, scopes; deactivation blocks login, unassigns open/in-progress/pending items, removes the agent from on-call schedules and deletes their private reports; removing an agent from a workspace unassigns open items there. [Agents]
- **Delegation** — approval delegation (one active delegate per user, time-boxed, recorded on the approval; API since Jan 2026); **assume identity** for admins to troubleshoot as another user (blocked for restricted-group agents); OOO requests for someone else (permission). [Approvals, Roles]
- **Authentication & provisioning** — Freshworks organisation login (unified across Freshworks products), **SSO** for agents and requesters via SAML 2.0, OAuth/OIDC (Microsoft Entra ID, Google) and simple JWT SSO (details unverified), **MFA** via the Freshworks org (unverified), **SCIM 2.0 provisioning** from **Okta** and **Microsoft Entra ID** through marketplace/organisation apps (tenant SCIM endpoint + organisation admin API key; group linking, schema discovery, attribute write-back per a third-party guide; Pro/Enterprise claimed — unverified), Active Directory user import through the Discovery Probe, **IP range restrictions** (Pro+), password policy and session timeout settings, per-agent API keys that act with the agent's role. [SSO/SCIM]
- **AI access controls** — Copilot enabled per role and licensed per agent; *Freddy Insights* permission; *Manage AI Agent Studio* permission; Copilot Agent action policies and permission checks (see `ai`). [AI]
- **Workflow context** — Workflow Automator and supervisor rules run with system privileges (not as the triggering user); deactivated agents leave workflow references to clean up manually. [Workflow Automator]

### Implementation notes
- Grant = `(role, resource, action, scope)` where scope ∈ {all, workspace, member_observer_groups, specific_groups[], assigned}; evaluate as SQL predicates (`group_id IN (...) OR responder_id = :me`) ANDed with hard restrictions (workspace membership, restricted workspace allow-list, restricted groups) so convenience grants never bypass confidentiality.
- Account-wide vs workspace-wide admin: store `role_assignment(user_id, role_id, workspace_id NULL = account-wide)`.
- Restricted-group membership changes become approval requests to group leaders (first response wins) with audit entries.
- Requester visibility: own tickets ∪ tickets where requester is in CC ∪ department tickets if prime user — excluding tickets in restricted groups.

## Module: integration

### Features
- **Freshworks Marketplace** — public and private (custom) apps installed per account/workspace: identity (Okta, Microsoft Entra ID, Google Workspace), collaboration (Microsoft Teams, Slack, Zoom), DevOps (Jira, Azure DevOps, GitHub, GitLab), endpoint/MDM (Intune, SCCM, Jamf, Kandji, Automox, Workspace ONE), cloud (AWS, Azure, GCP), monitoring tools (alert integrations), Freshworks products (Freshdesk escalation to IT, Freshchat, Freshcaller/Contact Center, Freshsales), iPaaS (Zapier, Workato, Make) and HR systems for onboarding triggers (Workday/BambooHR — unverified). [Marketplace]
- **Orchestration apps** — integration actions exposed to the Workflow App node, metered as transactions (see `platform`). [Orchestration Center]
- **REST API v2** — JSON API over HTTPS with API-key basic auth (key acts with the agent's role); resources include tickets (+conversations, notes, tasks, time entries, CSAT, approvals, requested items), problems, changes (+notes since Nov 2026), releases, CABs, maintenance windows (Nov 2026), assets, components, relationships, software/applications (licences, installations, users), contracts, purchase orders, vendors, products, agents, requesters, groups, roles, departments, locations, service catalog (items, categories, place request), solutions, announcements, SLA policies, business hours, custom objects, onboarding requests, canned responses, approvals/delegations; filter queries, pagination, per-plan per-minute rate limits (exact numbers unverified). [API v2]
- **Webhooks** — outbound via the workflow Web Request node (any event → HTTP call with placeholders); inbound monitoring webhooks for alerts; FDK serverless apps subscribe to product events (ticket create/update, etc.), scheduled events and external events. [Developer Platform]
- **Freshworks Developer Kit (FDK)** — custom apps with UI placements (ticket/change/asset sidebars, full-page apps, navigation), serverless functions, KV and entity storage, secure installation parameters, OAuth to third parties, request templates; private apps per account. [FDK]
- **MCP Gateway (2026)** and **Microsoft 365 Copilot** connector for AI interoperability (see `ai`).
- **Jira / Azure DevOps linkage** — create or link issues/work items from tickets, problems and changes; sync status and comments (two-way sync depth per app; unverified). [Marketplace]

### Implementation notes
- Expose one permission-checked service layer used by UI, API, workflows, apps and AI tools; publish domain events (outbox pattern) to drive webhooks, app events and the analytics store.
- Provide per-tenant API rate limiting (token bucket per key + per account) and idempotency keys on create endpoints.

## Module: admin

### Features
- **Admin console** — searchable admin home split into **Global Settings** (account, user management — agents, requesters, groups, roles, departments, locations; asset management & Discovery Hub; channels; apps; security; billing) and **per-workspace settings** (service management: field manager, statuses, SLA/OLA, business hours, assignment policies, catalog, KB, e-mail settings/notifications, workflow automator, supervisor rules, scenario automations, canned responses, change lifecycle, risk policies, CAB). [Admin]
- **Branding** — helpdesk name, logo, favicon, colours, portal URL, custom domain with custom SSL. [Admin]
- **Subscription & billing** — plan, agent seats (full-time/occasional/business), day passes, add-ons (Copilot, project users, orchestration packs, asset units/ITAM edition, AI Agent sessions), invoices, trial (14 days). [Billing]
- **Data residency** — account hosted in a regional data centre chosen at sign-up (US, EU, India, Australia, Middle East — list unverified). [Security]
- **Sandbox, audit log, account export, scheduled data export** — see `platform`/`analytics`.
- **Release management for admins** — continuous delivery; **Biannual Updates** (May/November) announcing breaking changes with dates; Early Access programme; monthly release notes. [Biannual Updates]
- **Setup aids** — templates for workspaces, workflows, catalog items and journeys; Freddy workflow generation (see `ai`).

### Implementation notes
- Keep configuration as versioned metadata objects with stable IDs (needed for sandbox sync, audit diffs and rollback); feature flags per tenant for early-access rollouts and plan gating.

## Module: devops

### Features
- **DevOps integrations** — Jira, Azure DevOps, GitHub, GitLab apps; change/release APIs let CI/CD pipelines create standard changes, attach deployment details and update status; projects (agile backlog/sprints/versions) linked to GitHub/GitLab. [Marketplace, Projects]
- **Ops tooling** — alert management, on-call, status page and (2026) FireHydrant/Robusta incident-response and AI investigation capabilities for engineering teams. [ITOM]
- No native DORA metrics, deployment tracking or change-success analytics (gap).

### Implementation notes
- Offer a "change from pipeline" endpoint with pre-approved standard-change templates, automatic risk scoring and links to commits/builds; compute DORA metrics from change and incident records.

## Access control & org structure

- **Org hierarchy** — one **account** (Freshworks organisation identity) → **Global** scope (people, departments, locations, CMDB/asset management, discovery, roles, account-wide admins) → **workspaces** (IT + business departments; each owns its agents, groups, forms, catalog, KB, SLAs, workflows, reports) → **agent groups** (members, observers, leaders; restricted or not). People structure: **departments** with **department heads**, **reporting managers** on each user, hierarchical **locations**, **requester groups** (manual or rule-based) and, in MSP mode, **clients (companies)** as an extra partition.
- **Roles** — built-in roles (Account Admin, Workspace Admin, IT/Business Supervisor, IT/Business Agent, Problem/Change/Release/Configuration/Contract/Procurement Manager, IT Ops Agent, Project Manager/Member) plus custom roles. **Agent roles** grant module privileges (view, reply, edit properties, delete, manage) with a **scope per privilege**; **admin roles** grant View/Edit/Delete/Manage per settings area and are **account-wide or workspace-wide**. Multiple roles are unioned (most permissive grant wins).
- **Data-visibility scoping** — agent scopes: all groups/workspace, member + observer groups, specific groups, or assigned items only; observers read but cannot edit; **restricted groups** hide their tickets from all non-members (even workspace-wide agents and department-wide requesters; tickets only); **restricted workspaces** admit only explicitly added people (even account admins are excluded) though published catalog items and articles remain visible; requesters see their own and CC'd tickets, and **prime users** see their department's (or company's) tickets; catalog items and KB folders are visible by requester group, department, agent group, logged-in/all users; reports respect the viewer's data scope even when report privileges are elevated.
- **Multi-company / domain separation** — no true domain separation: ESM uses workspaces (configuration + data partitions under one global user/CMDB space) and MSPs use **MSP mode** (client partition with client-specific SLAs, catalog/KB applicability and reports); separate Freshservice accounts are needed for hard isolation; sandbox is a separate configuration tenant.
- **Delegation & impersonation** — approval **delegation** (one active delegate per user, time-boxed, audited, API); **assume identity** for admins (blocked for restricted-group agents); OOO requests made on behalf of others (permission); group-leader approvals for restricted-group membership changes (first leader response wins, delegation not applicable).
- **Authentication & lifecycle** — Freshworks org login with SSO (SAML 2.0 / OAuth-OIDC with Entra ID and Google / JWT), MFA via the org (unverified), **SCIM** provisioning from Okta and Entra ID (unverified tier), AD import via Discovery Probe, IP range restrictions (Pro+), password and session policies, per-agent API keys bound to the agent's role; agent deactivation unassigns work, removes on-call slots and deletes private reports.
- **Automation context** — workflows, supervisor rules and orchestration run with system privileges; App-node calls use the credentials configured in the orchestration app (least-privilege service accounts recommended).
- **How AI respects permissions** — Copilot is enabled **per role** and licensed **per agent**; *Freddy Insights* and *Manage AI Agent Studio* are separate permissions; **Copilot Agent** checks the agent's permissions before recommending and before executing an action, and each action carries a policy (**Always allowed / Approval required / Blocked**) plus allowed groups, with newly added app actions **unmapped** by default; the employee-facing **AI Agent** answers from KB content governed by folder visibility, and admins can **filter knowledge sources** per agent/request type; how SharePoint/Drive/Confluence item-level permissions are applied is **not documented** (unverified — a design risk to solve explicitly).

## AI capabilities

- **Reply Suggester** — drafts a reply from the ticket conversation grounded in KB articles; the agent edits before sending.
- **Multilingual Reply Suggester** — same, generated in the requester's language.
- **Writing Assistant** — rewrites agent text for tone, clarity and grammar; expand/shorten/rephrase.
- **Translator** — translates ticket content between the requester's and the agent's languages.
- **Ticket Summariser** — condenses the conversation; auto-runs on close when the conversation has >1 message (SRs excluded).
- **Resolution Notes Generator** — drafts resolution notes from the ticket history for audit and hand-offs.
- **Post Incident Report Generator** — drafts the PIR (symptoms, root cause, impact, diagnosis, resolution, prevention, action items) from the major-incident timeline.
- **Test Case Generator** — produces test cases from the issue/change context.
- **Similar Incident Suggester** — retrieves past tickets with similar context (English only) for reuse of fixes.
- **Resolution insights** — infers likely root cause and fix steps from similar resolved tickets.
- **Intelligent Related Changes / Find Initiating Changes** — ranks changes closed in the last 14 days by likelihood of causing the incident; one-click link.
- **Similar Change Suggester / change recommendations** — shows comparable recent changes on a change record and accepts feedback.
- **Field Autofill Suggester** — predicts category/item, group, priority and other fields from ticket text.
- **Sentiment analysis** — classifies requester sentiment (negative/neutral/positive) with trend and explanation.
- **Help Article Generator** — drafts KB articles from ticket context or a topic (public sources).
- **Knowledge Content Recommendations** — suggests relevant articles beside the ticket while troubleshooting.
- **Conversational Copilot ("ask me anything")** — chat panel answering questions about the record and knowledge with citations and follow-ups.
- **Proactive Copilot insights** — surfaces relevant articles and historical tickets automatically as work progresses (Sept 2026).
- **Copilot agentic configuration** — admins write instructions that shape Copilot behaviour and priorities (Sept 2026).
- **Copilot Agent actions / next-best actions** — recommends and executes in-ticket actions (field updates, app actions) after human approval under per-action policies and permission checks.
- **Image support** — extracts information from screenshots/images in tickets and chats; improved file understanding (2026).
- **Freddy AI Agent** — employee-facing conversational agent (portal, Slack, Teams, Email Bot, Microsoft 365 Copilot) with multi-turn, multilingual, formless intent capture, cited answers, catalog ordering, ticket creation and human hand-off.
- **Enterprise search for the AI Agent** — RAG over the KB, SharePoint, Google Drive, Confluence, crawled URLs and files, with sync diagnostics and per-agent source filtering.
- **Freddy AI Agent for Email** — agentic multi-reply e-mail conversations until resolution (Sept 2026).
- **ServiceBot form prefill** — Freddy pre-fills the ticket form from the Slack/Teams conversation when a user escalates.
- **Freddy AI Agent Studio** — no-code builder for task-specific AI agents with instructions, knowledge, agent workflows, ~30 integrations, custom functions and preset triggers.
- **Natural-language workflow generation** — turns an admin's plain-language process description into validated executable workflow logic for AI agents.
- **MCP Gateway** — exposes Freshservice context and actions to external AI tools via Model Context Protocol.
- **Freddy AI Insights** — proactive anomaly/trend/outlier cards with root-cause tree maps and summaries, customised insights and conversational (natural-language) insights.
- **AI change risk surveys** — Freddy generates risk-assessment questionnaires for change risk policies.
- **Alert correlation (Freddy ML)** — learns alert↔incident patterns to auto-attach alerts to open incidents and reduce noise; manual links retrain it.
- **Skill inference for routing** — weekly ML over six months of history assigns agent skills/proficiency used by skill-based assignment policies.
- **XLA analysis** — experience-level scoring from service signals with (marketing-stated) AI analysis of sentiment.
- **ITAM predictive impact analysis / drift detection** — dependency-map-based "what breaks if this changes" and baseline drift flags (AI involvement partly unverified).
- **AI incident investigation (Robusta, announced Oct 2026)** — AI root-cause analysis, pre-populated incident timelines and suggested runbooks (not yet shipped).
- **AI usage analytics** — AI Agent overview report, Copilot usage and session metering.

## Differentiators

- **Time-to-value for mid-market ITIL** — full ITIL suite (incident, problem, change, release, catalog, KB, SLM, CMDB) configurable by admins without developers; transparent per-agent pricing with a Starter tier.
- **Change Lifecycle builder per change type** with transition conditions, field locks and versioned publishing that never breaks in-flight changes.
- **Change risk policies** combining scored risk profiles and weighted, AI-generated risk surveys (highest-severity or weighted-average) re-evaluated on every update.
- **CAB Huddle** — run CAB meetings inside the tool with agenda, per-change decisions and e-mailed summaries synced to O365/Google calendars.
- **Experience Level Agreements (XLAs)** natively scored per ticket (reliability, quality, effort themes, weights, rewards/deductions, threshold escalations) — rare among ITSM tools.
- **Approval groups & chains** with Everyone/Anyone/Majority/First-responder rules, delegation and approvals from e-mail, portal, mobile, Slack and Teams.
- **Assignment policy framework** — availability-gated (shift + 60-minute end-of-shift guard + OOO), load- and skill-ranked routing with ML-inferred skills and a "preview policy" explainer.
- **Device42-powered ITAM** — agent/probe/cloud/SaaS discovery plus application dependency mapping, business service mapping, reconciliation and drift detection in one product, with transparent **Asset Unit** pricing.
- **SaaS management built in** — usage, spend, under-utilisation and licence reclamation alongside HAM/SAM.
- **ITSM + ITOM in one SKU** — alert management with ML correlation, service health, on-call (5-level escalation, SMS/voice/WhatsApp) and status page without a separate PagerDuty/Statuspage.
- **Workflow Automator** with expression, JSON-parser, web-request, timer, reader and orchestration app nodes, Liquid placeholders and execution logs, plus a metered **Orchestration Center** of 40+ identity/collaboration apps.
- **ESM via workspaces + Journeys** — department workspaces (with restricted workspaces for HR/legal confidentiality) and cross-department Journeys for onboarding/offboarding and other lifecycle flows.
- **Restricted groups** with group-leader approvals — confidentiality inside a shared workspace without separate instances.
- **Freddy AI breadth** — ~35 Copilot/Agent/Insights features, AI Agent Studio with natural-language workflow generation, **MCP Gateway**, Microsoft 365 Copilot channel and policy-gated Copilot agent actions.
- **Collaboration-native** — ServiceBot in Slack/Teams for requests, approvals and agent notifications; major-incident collaboration with Teams/Zoom, stakeholder e-mails and status page from one widget.
- **Sandbox with config sets** (≤250 configs, dependency-aware) for safe change of configuration (Enterprise).
- **New-gen project management** (agile + waterfall, Gantt/Kanban, sprints) linked to ITSM records, with cheap project-only licences.
- **Predictable change management for admins** — Biannual Updates with dated breaking-change notices.
- **Gaps to beat** — no true domain separation, no SecOps/GRC, no PPM portfolio/financial planning, no capacity/continuity, limited stockroom/reorder automation, undocumented AI permission propagation for external knowledge sources, major-incident auto-detection unconfirmed.
