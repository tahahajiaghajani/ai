# Other ITSM tools — Ivanti Neurons for ITSM, SysAid, HaloITSM, TOPdesk, Xurrent/4me, OpenText SMAX, EasyVista, InvGate, Zendesk for IT, SolarWinds, Atera, IFS Assyst, Alemba, monday service, open-source (GLPI, iTop, Znuny, Zammad, RT, osTicket, Snipe-IT, NetBox) and AI-native service desks

Scope note: this report records only capabilities that are distinctive compared with ServiceNow, JSM, Freshservice, BMC and ManageEngine, which are covered in other reports. Standard ITIL features (incident/request forms, basic SLAs, CAB and so on) are left out unless a tool does them in an unusual way. "(unverified)" marks facts taken from training knowledge or secondary sources that I could not confirm against a primary source in this research pass (research date: 2026-11-07).

## Overview

| Tool | Positioning | Editions / packaging | Latest release seen (late 2026) |
|---|---|---|---|
| **Ivanti Neurons for ITSM** | Enterprise ITSM/ESM on a metadata "business object" platform (Ivanti Service Manager/HEAT lineage; Cherwell customers are being migrated here). SaaS and on-prem. It ties into the Ivanti Neurons endpoint platform (bots, discovery, patch, risk-based vulnerability). | ITSM, ITAM and "Line of Business" (ESM) licences. AI package add-on for search and GenAI. **Agentic AI add-on** (SaaS only, enabled by a feature flag after purchase). | Quarterly: 2025.1–2025.4; **2026.1** (Jan 2026) shipped Agentic AI and the modern Layout & Designer. The self-service agent went to a controlled release in April 2026. Later 2026.x releases exist (unverified). |
| **SysAid** | Mid-market ITSM that is GenAI-first ("SysAid Copilot"). Two UIs: **SysAid Spaces** (new) and **SysAid Classic**. | Copilot suite. Some AI features work only in Spaces. Tier mapping unverified. | Rolling SaaS releases. Named in the inaugural 2025 Gartner MQ for AI Applications in ITSM. |
| **HaloITSM** | UK vendor. One codebase with **HaloPSA** and **HaloCRM**, which gives ITSM PSA-grade contracts, billing and multi-client features. | Per-agent licence that includes all modules (unverified). | **2026 second release (v2.236)**: AI Agents and AI Abilities as runbook steps, ticket clustering, parallel approvals. |
| **TOPdesk** | Dutch SaaS ESM covering IT, Facilities (FM) and HR, built around "cards". Strong on FM, reservations and operations management. | Plans include **"Engaged"** and **"Excellent"** (AI features are tagged to them). A third, entry plan is presumably "Essential" (unverified). AI features are activated in AI settings at no extra cost. | AI rollout Mar–Oct 2026: categorization, summarization, AI Triage, **TOPdesk Robin**, **MCP**, AI Readiness Dashboard. |
| **Xurrent (ex-4me)** | SaaS ITSM/ESM that is **SIAM-native and multi-account**. It added **Xurrent IMR** (the former Zenduty: on-call, alerting, incident response). | **Sera AI** is included in all tiers at no added fee (Aug 2025). Autonomous agents and an open MCP server were announced in May 2026. | Monthly releases. Sera AI Studio (May 2026) and further Sera AI Agents (Sep 2026) come from Xurrent update listings (unverified). |
| **OpenText SMAX** (now marketed as OpenText Service Management) | "Codeless" ITSM/ESM. **IDOL-based Smart Analytics** (Smart Ticket, Hot Topics, Smart Search). Containerized, on-prem or SaaS. | Bundled with the OpenText IT Operations portfolio (Universal Discovery/UCMDB, Asset Manager). **IT Operations Aviator** (private GenAI). | Cloud Editions (CE) quarterly. CE 24.2 integrated Aviator into SMAX for service desk agents. Later CEs unverified. |
| **EasyVista** | French ITSM platform: **EV Service Manager**, **EV Self Help** (guided procedures), **EV Observe** (monitoring/observability), **EV Pulse AI**, EV Marketplace. Majority owner of **OTRS** (closed Mar 2025). | Platform releases. | **2025.3** (Dec 2025): AI data backbone, node-based knowledge model, EV chatbot inside Microsoft Copilot. 2025.2 added EV Pulse AI Conversations (LLM chatbot). |
| **InvGate** | Service Management plus Asset Management (formerly Service Desk and Insight). AI Hub is embedded rather than sold as an add-on. | AI Hub for Asset Management went GA in May 2026. | **ENVISION'26**: 11 features (Agent Studio, AI workflow generation, RFID audits, AI-asset CI family, MCP server, Product Catalog). |
| **Zendesk for employee service** | CX platform extended to IT/HR via the **Employee Service Suite** on the "Resolution Platform". | AI agents (Essential/Advanced), Advanced AI add-on, Copilot. | Relate 2026 (May): **Employee Service AI Agents** (rollout to eligible customers Nov 3–Dec 1, 2026). **Zendesk ITAM** GA May 2026. **Unleash** enterprise search acquired Dec 2025. |
| **SolarWinds Service Desk** | Cloud ITSM (ex-Samanage) with discovery and "risk detection". | Essentials, Advanced and Premier tiers (unverified). | Oct 2025 AI roadmap: AI Incident Correlation and AI KB Generation. Q1 2026 update: an AI chatbot with its own admin controls (unverified). |
| **Atera** | RMM + PSA/helpdesk for MSPs and internal IT. | Per-technician plans. AI Copilot, IT Autopilot. | **IT Autopilot** (May 2025), **Robin** on-device autonomous agent (Mar 2026). Visionary in the 2026 Gartner MQ for Endpoint Management. |
| **IFS assyst** | ITSM/ITOM/ESM (ex-Axios) inside IFS. CMDB- and discovery-centric. | IFS.ai. | IFS acquired **TheLoops** (Jun 2025) for agentic AI (agent builder, orchestration, MCP, human approvals). Which agents have reached assyst is unclear. |
| **Alemba Service Manager** | UK enterprise ITSM (vFire lineage). PinkVERIFY 2025 (22 processes). | The self-service portal needs no licence. | **Hermes 10.2025.Q4** (GA 4 Dec 2025). AI assistant in preview. |
| **monday service** | ESM built on monday Work OS boards. | AI is billed via paid AI features/credits. | Full release 2025. AI service agents including an Intake & Triage Agent. |
| **GLPI** | Open source (GPL) ITSM plus inventory/asset management, from Teclib'. | Community edition plus GLPI Network subscription/cloud. | **GLPI 11.0** (1 Oct 2025): native forms, service catalog, custom assets, 2FA, webhooks. GLPI 12 docs are appearing. |
| **iTop** (Combodo) | Open source (AGPL) **CMDB-centric** ITSM with an XML data model. | Community, plus Combodo Essential/Professional editions with extra modules (unverified). | 3.2 line, and **3.3.0** (Flow class, impact-analysis UX, Cloud and container classes). |
| **Znuny** | Open source fork of ((OTRS)) Community Edition, with LTS. | Community, plus Znuny GmbH support/add-ons. | **7.3.x** (7.3.1 on 2026-03-25, 7.3.3 on 2026-05-27). 7.2.1 added the "process shop". |
| **Zammad** | Open source (AGPL) omnichannel helpdesk. | Self-hosted or hosted. AI charged per call (€0.03 per call in pre-release pricing). | **7.0** (2026): AI agents, ticket summary, writing assistant. 7.0.1 was a security release (Apr 2026). |
| **RT (Request Tracker)** | Open source (GPLv2) ticketing with scrips, lifecycles and assets. | Best Practical support/hosting. | RT 5.0.x; RT 6.0 (unverified). |
| **osTicket** | Open source (GPL) simple helpdesk. | osTicket.com hosted. | 1.18.x (unverified). |
| **Snipe-IT** | Open source (AGPL) ITAM: assets, licences, accessories, consumables, components. | Self-hosted or Grokability hosted. | v8.x (unverified). |
| **NetBox** | Open source (Apache-2.0) **DCIM/IPAM "source of truth"**. | NetBox Labs Cloud/Enterprise, plus NetBox Discovery, Assurance and Copilot. | **4.4** (Sep 2025), **4.5** (Jan 2026; 4.5.4 on 2026-03-03). |
| **AI-native desks** | Conversational "front door" products that act on requests instead of only answering them. | Moveworks (now ServiceNow, closed 15 Dec 2025), Aisera (Automation Anywhere acquisition announced Nov 2025, unverified), Espressive Barista (Resolve Systems, Sep 2025), Atomicwork, Rezolve.ai, Serviceaide Luma, Leena AI, Siit. | See the "Module: ai" and "AI capabilities" sections. |

Key market shifts as of late 2026:
1. **MCP servers** have become a standard ITSM integration surface. TOPdesk, InvGate, Xurrent, Halo and Atomicwork all expose one, and each scopes it to the calling user's permissions or makes it read-only.
2. **Agentic AI is sold as a governed add-on** with per-action autonomy levels: Ivanti's Agentic AI licence, InvGate Agent Studio (auto, confirm or never per action), Halo AI Agents that run under an "Application" identity, and Zammad AI agents that are visible in the live user bar.
3. **AI-native start-ups are being absorbed**: ServiceNow bought Moveworks, Resolve bought Espressive, Automation Anywhere bought Aisera (unverified), IFS bought TheLoops and Zendesk bought Unleash.

## Sources

- Ivanti: https://docs.ivanti.com/neurons-for-itsm-release-notes-enu-latest/whats-new-enterprise-service-management-20261 ; https://docs.ivanti.com/neurons-for-itsm-release-notes-enu-latest/whats-new-enterprise-service-management-20254 ; https://help.ivanti.com/ht/help/en_US/ISM/2025/Release%20Notes/Content/Whats-New/What's-New-2025.2.htm ; https://help.ivanti.com/ht/help/en_US/ISM/2026/admin-user/Content/AgenticAI/Agentic-AI.htm ; https://help.ivanti.com/ht/help/en_US/CLOUD/vNow/published-neurons.htm ; https://help.ivanti.com/ht/help/en_US/CLOUD/vNow/what's-new-2024.1.htm ; https://help.ivanti.com/ht/help/en_US/CLOUD/vNow/what's-new-2024.2.htm ; https://help.ivanti.com/ht/help/en_US/ISM/2025/admin-user/Content/Reference/Configuration%20Menu%20Matrix.htm ; https://www.uctoday.com/service-management-connectivity/ivantis-latest-release-puts-agentic-ai-itsm-into-commercial-deployment/ ; https://www.helpnetsecurity.com/2026/01/27/ivanti-neurons-ai-advancements/
- SysAid: https://documentation.sysaid.com/docs/sysaid-ai ; https://documentation.sysaid.com/sysaid-ai ; https://www.sysaid.com/?p=83261
- HaloITSM: https://www.usehalo.com/product-updates/whats-new-in-haloitsm-2026-second-release ; https://usehalo.com/product-updates/whats-new-in-haloitsm-q2-2025/ ; https://www.usehalo.com/product-updates/whats-new-in-haloitsm-q4-2025 ; https://www.usehalo.com/product-updates/haloitsm-new-features-q1-2025 ; https://www.usehalo.com/product-updates/haloitsm-new-features-q1-2024 ; https://usehalo.com/haloitsm/sqlschema
- TOPdesk: https://community.topdesk.com/news-and-announcements-125/topdesk-ai-launch-stay-up-to-date-with-all-updates-558 ; https://topdesk.com/en/?p=37431 (Feb 2025 launches) ; https://www.topdesk.com/en/blog/whats-new-august-2025/
- Xurrent: https://www.xurrent.com/help/account-trust ; https://help.xurrent.com/help/affected_sla/ ; https://help.xurrent.com/help/affected_sla_fields/ ; https://developer.xurrent.com/v1/affected_slas/ ; https://developer.xurrent.com/v1/time_allocations/ ; https://www.xurrent.com/blog/introducing-billing-integration-effort-classes ; https://www.xurrent.com/product-updates/outsource-support-for-your-assets ; https://www.apmdigest.com/xurrent-introduces-autonomous-agents-and-open-mcp-server ; https://www.businesswire.com/news/home/20250819859583/en ; https://www.xurrent.com/incident-management-response/on-call-management ; https://www.xurrent.com/blog/zenduty-ai-incident-management-faster-mttr ; https://startupintros.com/orgs/xurrent-imr-formerly-zenduty
- OpenText SMAX: https://www.microfocus.com/media/brochure/micro-focus-smax-brochure.pdf ; https://blogs.opentext.com/elevate-human-potential-with-cloud-editions-ce-24-2/ ; https://docs.microfocus.com/SM/9.61/Hybrid/Content/smartanalytics/tasks/extend_ocr_to_other_field.htm ; https://managenordic.no/en/service-management-automation
- EasyVista: https://www.easyvista.com/press-release/easyvista-introduces-2025-3-platform-release-advancing-a-reliable-data-backbone-for-ai-powered-itsm/ ; https://www.businesswire.com/news/home/20250325024833/en/ ; https://www.marketscreener.com/news/easyvista-advances-everyday-ai-in-itsm-with-new-platform-release-2025-2-ce7c5fdfd981f422 ; https://yespress.io/easyvista.md
- InvGate: https://blog.invgate.com/invgate-product-announcements-at-envision ; https://invgate.com/faq/invgate-asset-management/discovery-and-inventory ; https://invgate.com/faq/ai-hub ; https://invgate.com/en/ai-hub
- Zendesk: https://futurumgroup.com/?p=96976 ; https://www.uctoday.com/?p=748052 ; https://nucleusresearch.com/wp-content/uploads/2026/06/26113-How-Zendesk-is-paving-the-path-towards-next-generation-service.pdf ; https://www.businesswire.com/news/home/20260519168171/en/ ; https://www.eesel.ai/blog/zendesk-ai-agents-intelligent-support-guide
- SolarWinds: https://www.businesswire.com/news/home/20251008028432/en/ ; https://thwack.solarwinds.com/discussion/152092/april-14-release-precision-approvals-workflow-visualization-ai-tone-enhancer-and-more ; https://thwack.solarwinds.com/discussion/152127/responses-to-your-top-questions-from-the-q1-26-service-desk-product-update ; https://businesswire.com/news/home/20230516005046/en/
- Atera: https://www.channelinsider.com/news-and-trends/atera-it-autopilot-launch/ ; https://www.atera.com/blog/introducing-ai-copilot-2-5/ ; https://briefglance.com/articles/atera-declares-an-end-to-it-tickets-with-autonomous-ai-agent-robin ; https://techintelpro.com/news/ai/agentic-ai/atera-named-a-visionary-in-2026-gartner-magic-quadrant-for-endpoint-management-tools
- IFS assyst: https://www.ifs.com/pl/insights/news/ifs-acquires-theloops-to-launch-the-industrial-ai-workforce ; https://www.techzine.eu/news/infrastructure/132561/ifs-acquires-theloops-ai-agents-for-critical-industries
- Alemba: https://alemba.com/ai ; https://alemba.com/blog/news/asm-hermes-102025q4-release
- monday service: https://support.monday.com/hc/en-us/articles/28587066070290-Using-AI-in-monday-service ; https://ir.monday.com/news-and-events/news-releases/news-details/2025/monday.com-Announces-Full-Release-of-monday-service-its-AI-Enterprise-Service-Management-Platform/default.aspx ; https://monday.com/w/use-cases/ticketing-software
- GLPI: https://www.glpi-project.org/en/glpi-11-is-out ; https://help.glpi-project.org/documentation/modules/assistance/service-catalog ; https://newreleases.io/project/github/glpi-project/glpi/release/11.0.0
- iTop: https://github.com/Combodo/iTop/releases/tag/3.3.0 ; https://combodo.com/features/ ; Combodo iTop `profiles.xml` / `userrightsprofile.class.inc.php` (iTop source, read locally)
- Znuny: https://doc.znuny.org/znuny-7_2/releases/7_2_1/index.html ; https://znuny.org/en/releases ; https://znuny.org/roadmap
- Zammad: https://zammad.com/en/product/zammad-7-0 ; https://zammad.com/en/product/releases/7-0 ; https://user-docs.zammad.org/en/7.0/extras/ai-features.html ; https://zammad.com/en/artificial-intelligence
- NetBox: https://netboxlabs.com/docs/netbox/release-notes ; https://netboxlabs.com/blog/netbox-4-5-general-availability-and-ecosystem-update/
- AI-native: https://www.businesswire.com/news/home/20251215128980/en/ServiceNow-completes-acquisition-of-Moveworks ; https://atomicwork.com/product-announcements ; https://www.atomicwork.com/features/ai-assistant-for-agents ; https://atomicwork.com/features/atom-skills ; https://www.rezolve.ai/es-mx/platform/agentic-ai ; https://www.rezolve.ai/blog/agentic-ai-for-modern-itsm ; https://app.mergerlinks.com/transactions/2025-09-10-espressive ; https://www.getmacha.com/blog/aisera-complete-guide ; https://www.speechtechmag.com/Articles/News/Speech-Technology-News/Leena-AI-Launches-Agentic-AI-Colleagues-170722.aspx ; https://www.serviceaide.com/data-sheet/luma-virtual-agent ; https://intercom.help/siit/en/articles/8061829-activate-ai-assist-feature ; https://runbear.io/posts/best-it-help-desk-agents-slack-teams
- Open-source tools not fetched this pass (RT, osTicket, Snipe-IT): described from long-standing public documentation in training knowledge. Version numbers are marked unverified.

## Module: platform

### Features
- **Business-object metadata engine with Soft Lock** — Every record type in Ivanti is a Business Object (BO) with its own fields, relationships, forms, layouts, grids and rules. "Soft Lock" (2025.4) locks selected metadata properties of a BO against editing. The properties left editable keep their tenant changes across future updates. [Ivanti]
- **Clone Business Object** — Copies fields, layouts, grids, forms and rules from an existing BO (2026.1). Relationships are cloned one level deep. Roles, workflows and named relationships must be configured by hand. In the cloud it is allowed only in non-production; on-prem it needs the `EnableCloneBO` flag. A clone of a locked BO becomes a custom BO without the locks. [Ivanti]
- **Composite Actions and Workflow Variables** — Composite actions run quick actions in a fixed order and pass results through ephemeral variables, without writing to database fields. Workflow variables (Text type only) are created with the "Update Stored Values and Variables" block, read with `GetWorkflowVariable()`, and last until the workflow instance completes. [Ivanti]
- **Modern Layout & Designer** — Admins design list layouts as Grid, Kanban or Gallery (Card) views. They are opt-in and reuse existing detail screens; modern form views are not GA yet. [Ivanti 2026.1]
- **Codeless configuration** — All tailoring (record types, fields, forms, business rules, processes, portal) is done in the Studio UI without scripting, so upgrades do not break customizations. This is SMAX's core selling point. [OpenText SMAX]
- **Layered XML data model** — The whole iTop model (classes, attributes, lifecycles with states, transitions and stimuli, menus, profiles) is XML spread across modules. Customizations are `_delta="define|redefine|delete"` fragments merged at setup ("compilation") into generated PHP. Extensions add classes and attributes without editing core. Combodo's iTop Designer edits the model in a web UI. [iTop]
- **Runbooks with AI steps** — Halo Integration Runbooks are a flowchart designer of steps (API calls, conditions, loops). Two new action types: **AI Ability** (an instruction plus input variables returns output variables; a "force JSON" option fills several variables at once) and **AI Agent** (a multi-step agent using MCP-style functions). Each step has a request/response log viewer. [Halo] [AI]
- **Automation sequencing and auto-stages** — Halo automations carry a sequence number from 0 to 10; lower numbers run first and equal numbers queue together. Adding a workflow step can auto-create a matching stage whose name stays in sync. "Start an approval process" is available as a workflow action. [Halo]
- **Grouped dynamic filters** — Halo saved list filters take groups of up to three criteria. Criteria are ANDed inside a group and groups are ORed (e.g., "assigned to me" OR "new and unassigned"). [Halo]
- **Process management (BPM) for tickets** — In Znuny a Process contains Activities. Each Activity has Activity Dialogs (forms of selected fields), Transitions carry conditions on field values, and Transition Actions run steps such as setting state, queue or dynamic field or creating a ticket. 7.2.1 added a graphical, categorized "process shop" for starting processes. Processes can be imported and exported. [Znuny]
- **ACLs as dynamic form logic** — A Znuny ACL has a Match part (Properties for the current form or ticket, PropertiesDatabase for stored values) and a Change part (Possible, PossibleAdd, PossibleNot). The Change part restricts selectable states, queues, priorities, services, dynamic-field values and even action buttons per user or ticket context. [Znuny]
- **Core Workflows** — Zammad's condition-based UI logic shows, hides, requires, sets read-only, sets values or limits options on ticket, user and organization forms. It is evaluated live as the user edits. [Zammad]
- **Scrips and Lifecycles** — In RT a scrip is Condition + Action + Template, set per queue or globally and run per transaction or per batch. Lifecycles define custom statuses, allowed transitions, rights per transition and action buttons, with mappings for moving tickets between queues that use different lifecycles. TicketSQL is the query language. [RT]
- **Rules engines everywhere** — GLPI has business rules for tickets (criteria → actions, run on create/update) and assignment rules. Authorization rules map LDAP/SSO attributes to a profile plus an entity. Import and link rules govern inventory. Dictionaries normalize software and manufacturer names. [GLPI]
- **Board-based no-code ESM** — In monday service, records are items on boards with typed columns. Automations are sentence-like "recipes" ("When status changes to Done, notify requester"). This is a good UX pattern to copy for simple automations. [monday service]
- **Core webhooks, 2FA, forms and custom assets** — GLPI 11 moved native forms, custom asset types, TOTP 2FA and webhooks into core. These were previously the Formcreator/Fields plugins or not available at all. [GLPI]
- **Platform hygiene** — Ivanti offers OData filters with nested AND/OR, retention-based purging of workflow history and logs (cloud), HTML sanitization by default with a tag whitelist, SQL Always On support, dashboards with dark mode and colours pinned per pick-list value, and a "Refresh Record" UI action. [Ivanti]
- **AI-translated UI strings** — The Ivanti Localization Workbench machine-translates selected strings. OpenAI is the default engine; Google Translate, DeepL or Azure can be configured instead. Custom language files can be imported. [Ivanti] [AI]
- **Admin-customizable help** — Halo lets admins relabel, relink or hide the default help-menu entries and add their own. Custom-field hints can appear on hover via a "?" icon. [Halo]

### Implementation notes
- Model customization as layers (vendor base → extensions → tenant delta) and merge them deterministically at build or deploy time, as iTop does. Store a per-property lock flag (Ivanti Soft Lock) so a vendor upgrade re-applies the base and keeps unlocked tenant edits. A clone operation sets `origin=clone`, drops locks and forces roles and workflows to be re-bound by hand.
- Implement Znuny/Zammad-style option filtering as a pure function `(formState, user, record) → allowed values per field`. Run it on the client for the UI and on the server on submit, so a stale client cannot bypass it. Evaluate rules in a defined order with an optional "stop on match" flag.
- Halo-style grouped filters compile to `OR(AND(c1..c3), AND(...))`. The three-criteria limit keeps the UI readable.
- Keep workflow variables in the workflow-instance state (JSON), never in record fields, so resumable steps still see them after a restart.

## Module: incident

### Features
- **Ticket clustering with embeddings** — Halo (Configuration › AI) groups similar tickets by vector embeddings. Each cluster gets an AI-written description and resolution. Every ticket has a "Cluster Matched Tickets" tab. Past clustering runs are archived and exposed through the API's Cluster endpoint for trend reporting. [Halo] [AI]
- **Incident Correlation with boundaries** — Ivanti 2026.1 clusters related incidents. A "Boundary" option sets the grouping criteria. "Whitelist Filtering" excludes incidents containing given keywords from clustering. A flag icon on the dashboard counts incidents reported since the user's last visit. [Ivanti] [AI]
- **AI Incident Correlation → problem** — SolarWinds (announced Oct 2025) detects groups of related incidents and recommends opening a problem-management workflow. [SolarWinds] [AI]
- **AI-driven ticket linking** — Halo (Q2 2025) proposes links between related tickets. [Halo] [AI]
- **Smart Ticket from email or screenshot** — A user emails, or uploads a screenshot of an error from a phone. IDOL OCR extracts the text into Description, ML classifies category and assignment, and "Smart Interaction" suggestions are based on that text. OCR rule sets are configurable and Smart Ticket models can be retrained. [OpenText SMAX/Service Manager] [AI]
- **AI Triage** — When an incident opens, TOPdesk suggests category, priority and operator group (Oct 2026, Excellent plan). A separate AI Categorization arrived in Mar 2026 and got better accuracy in Oct 2026. [TOPdesk] [AI]
- **AI Intelligent Categorization with escalation rule** — SysAid suggests Category Sets from title and description. Admins control when the categorization escalation rule fires and which tickets it applies to. In Classic it is limited to the Incident and Request types. [SysAid] [AI]
- **AI Emotion and hover summary** — SysAid Spaces shows requester sentiment live, so negative tickets can be prioritized. A real-time case summary appears when you hover a ticket title in the queue. [SysAid] [AI]
- **Structured ticket summary** — Zammad 7.0 summaries always contain customer intent and a conversation summary; open questions, upcoming events and customer sentiment are optional. The summary is produced when the ticket is updated and the agent opens it. A pulsing indicator shows a new summary only when someone else made the change. [Zammad] [AI]
- **Visible AI agents in the inbox** — Zammad AI agents work in the background: they set category or priority, or overwrite the title. Each change is a ticket-history entry under the agent's name. While an agent works, an AI avatar shows in the live user bar and a blue/pink gradient circle shows in overviews. An "AI agent" action can be put in a macro to run on demand. Managing agents needs the `admin.ai_agent` permission. [Zammad] [AI]
- **Ticket translation** — TOPdesk translates the full ticket into the operator's language in one click (Jul 2026). Ivanti 2025.4 translates HTML fields into the logged-in user's language, with a language picker. [TOPdesk, Ivanti] [AI]
- **Writing aids** — Ivanti adds an "AI Text Suggestion" button on Description/Resolution fields and Email Assist drafts. SolarWinds expands shorthand such as "send logs" into a professional, friendly or empathetic reply. SysAid "AI Author" rewrites in chosen tones. Zammad's bubble-menu tools are expand draft, fix spelling/grammar, halve length and simplify, plus admin-defined custom tools, with a diff dialog to approve. [AI]
- **Caller identity verification** — Halo Security Questions: up to five questions with min/max length and regex rules, a required number of correct answers and a limit on wrong attempts. Users are prompted to set answers on the portal, and answers can be masked. Agents run the check on the call screen and a pass is saved against the call. [Halo]
- **Log a ticket from an asset** — A default ticket type set on a CI or asset type lets users raise tickets directly from the asset record. [Halo]
- **Collaboration aids** — Zammad has ticket checklists (with templates), shared drafts several agents can edit before sending, mentions, and time accounting with activity types. [Zammad]
- **CMDB-anchored logging** — IFS assyst logs every event against an affected item (Item A) and a further item or category (Item B), so incident data is always tied to CIs. [IFS assyst] (unverified)
- **Computed impact on create** — When CIs are attached to an iTop ticket, iTop walks the dependency graph and adds impacted CIs, services and contacts flagged "computed", alongside the "manual" ones. [iTop]
- **Incident Agent** — The Ivanti agent creates an incident from a natural-language description in chat or Teams (2026.1, Agentic AI add-on). [Ivanti] [AI]

### Implementation notes
- Clustering: embed `title + description` (plus resolution once solved). Recluster on a schedule (e.g., HDBSCAN) and assign new tickets online by nearest centroid. Persist `cluster_run(id, at, params)` and `cluster_member(run_id, ticket_id, score)` so trends can be reported across runs. Generate one LLM summary per cluster, not per ticket. Apply Ivanti-style boundaries (time window, service, location) and keyword exclusions before clustering.
- AI-made changes are normal audit entries with `actor_type = ai_agent` and the agent id. Mark AI-created records the way Halo does (`faicreated` on tickets, `aacreated` on actions, `kbaicreated` on KB, plus the creating agent id). Broadcast AI presence on the record so humans don't overwrite it at the same moment.
- Regenerate summaries on new entries with a debounce, and show a "new summary" badge only for changes made by other actors.

## Module: problem

### Features
- **Hot Topic Analytics** — SMAX uses IDOL to cluster tickets into visual "hot topics" so trends stand out, then drills into each topic to find the root cause. [OpenText SMAX] [AI]
- **Cluster-seeded problems** — Halo clusters carry an AI-written description and resolution that can seed a problem or known error. SolarWinds suggests opening a problem when it finds correlated incidents. [Halo, SolarWinds] [AI]
- **KB generation from common solved incidents** — SolarWinds (announced) uses GenAI to write knowledge articles from the most frequently solved incidents. [SolarWinds] [AI]
- **Incident-to-problem linking suggestions** — The Atomicwork agent assistant links incidents to problems and surfaces similar past incidents. [Atomicwork] [AI]
- **Graphical impact analysis** — iTop and GLPI draw the services and contacts affected by a failing CI, which helps scope a problem. [iTop, GLPI]

### Implementation notes
- A problem candidate is a cluster that crosses a size or velocity threshold within a time window and has no linked problem yet. Offer "Create problem from cluster", prefilled with the cluster summary, the dominant CIs and services, and links to the member incidents.

## Module: change

### Features
- **Parallel approval groups** — Each Halo approval step is "ungrouped", a "main group step" or a "group member". A group rejects as soon as any step reaches its rejection threshold and approves only when all steps reach their approval thresholds. Members inherit the main step's notifications and status changes, so the main step must come first. [Halo 2026]
- **Risk-score routing** — A configurable risk score is calculated per ticket (Q2 2025), and approval-process rules can branch on it (2026). [Halo]
- **Workflows (formerly "changes")** — Xurrent workflow templates generate tasks (including approval tasks) with dependencies. Tasks can be assigned to teams of trusted accounts, and a trust can limit this to specific teams. [Xurrent]
- **Simple vs extensive change** — In TOPdesk a simple change is one card. An extensive change runs through phases (request → authorization → progress → evaluation) with change activities and authorization activities. [TOPdesk] (unverified details)
- **Process-driven change** — In Znuny, CAB stages are modelled as process activities with dialogs, transition conditions and transition actions. [Znuny]
- **Lifecycle rights per transition** — RT lifecycles can require a specific right for a transition, e.g., only the CAB role may move a change to "approved". [RT]
- **Precision approvals and workflow visualization** — SolarWinds (2026) added targeted approver selection and a visual view of approval workflows. [SolarWinds] (details unverified)

### Implementation notes
- Approval-group algorithm: each step has `approve_threshold` and `reject_threshold` (count or %). On every vote, reject the group if any member's rejections ≥ its reject threshold. Approve when every member's approvals ≥ its approve threshold. Notifications and status changes are emitted only by the main step.
- Feed risk-score inputs (CI criticality, vulnerability count on affected CIs, failed-change history, change window) into a numeric score stored on the change, and let approval rules route on score bands.

## Module: request

### Features
- **Product Catalog bound to stock** — In InvGate, a Service Management catalog product (what the requester sees) maps to one or more Asset Management products (asset type + manufacturer + model) with live stock counts. At fulfilment the agent assigns a specific unit from stock, which updates the asset. Product profiles show total, available and assigned units with a 12-month trend. [InvGate, ENVISION'26]
- **Service Request Agent** — Picks the matching request template from a natural-language prompt and submits it. A Q&A Service answers "my active incidents", "incidents created last week" or the status of a given ID. [Ivanti 2026.1] [AI]
- **Post-submission self-service actions** — Admins can let users edit, cancel, reopen, "request again" or escalate a request after submitting it. [Ivanti SS V3]
- **Recent and trending services** — Halo adds two optional portal categories: the user's 10 most recently logged services and the 10 trending services. "Include Children" shows child tickets under their parent in My Tickets. [Halo]
- **Native forms and catalog** — GLPI 11 has an interactive form editor with conditions and destinations. Its catalog has categories with illustrations, typo-tolerant real-time search, and KB articles mixed into results. GLPI 12 documentation adds "pin to top of the service catalog". [GLPI]
- **Requestable assets and kits** — Snipe-IT users can request assets flagged "requestable". Predefined Kits bundle models, licences, accessories and consumables into one checkout. [Snipe-IT]
- **Agentic fulfilment** — AI-native desks fulfil password resets, account unlocks, group/distribution-list membership, software access and VPN fixes through IdP/MDM connectors. Atomicwork Atom ships 100+ skills. Zendesk Employee Service AI agents use Okta, Entra ID, Jamf and Intune for onboarding, access approvals and laptop lifecycle. [Atomicwork, Zendesk, Moveworks] [AI]
- **Approvals in chat** — Approval requests appear as approve/deny cards inside Slack or Teams. [Moveworks, Siit, Rezolve.ai] (unverified details)
- **Shop** — Xurrent "shop articles" are grouped into categories and ordered through shop orders whose order lines spawn fulfilment requests. [Xurrent] (unverified details)

### Implementation notes
- `catalog_item_model(catalog_item_id, model_id, preference)`. Stock = count of assets in status `in_stock` per model. Fulfilment soft-reserves one unit, then on completion sets the assignee and writes an asset history row linked to the request.
- "Trending" = requests per catalog item over the trailing N days. "Recent" = the user's last 10 distinct items.

## Module: knowledge

### Features
- **AI knowledge creation** — TOPdesk drafts knowledge items with AI (Mar 2026), and TOPdesk Robin turns fixes into knowledge items (Oct 2026). Its AI Answer Assistant (Jun 2026) suggests incident replies grounded in the KB. [TOPdesk] [AI]
- **AI Readiness Dashboard** — Rates whether the KB is ready for AI by volume, freshness and usage. Available to all customers (Oct 2026). [TOPdesk] [AI]
- **Knowledge Snippets** — Short answer units kept beside full articles. They feed instant answers in the portal, and each answer links to its source. [InvGate] [AI]
- **Data Pool** — The grounding corpus for SysAid Copilot, built from five dataset types: Service Record data, Q&A Sets, KB articles, Documents and URLs. "Monitor & Fine-Tune" lets AI admins validate Q&A sets. [SysAid] [AI]
- **Knowledge improvement loop** — Serviceaide Luma Knowledge federates enterprise sources and keeps recommending missing articles, corrections and retirement of unused ones. [Serviceaide] [AI]
- **Guided Self Help** — EasyVista "procedures" are decision trees (question → branch → answer or action) used by end users and agents. 2025.3 moved knowledge to an AI-optimized node-based model. [EasyVista] (node-model details unverified)
- **Permission-aware reporting and search** — Halo Query Builder returns only KB articles the running user may read. Ivanti filters which KB collections Self Service users see in the Teams bot by object permissions. [Halo, Ivanti]
- **Improved search** — Partial-word matching ("bene" finds "benefits") and related-term matching ("PC" finds computer, laptop and desktop) with the AI package. Semantic search is in preview. [Ivanti 2026.1] [AI]
- **Enterprise search** — Permission-aware search across 100+ systems (Confluence, SharePoint, Drive and others) via the Moveworks Reasoning Engine and Zendesk's Unleash (acquired Dec 2025). [Moveworks, Zendesk] [AI]

### Implementation notes
- Readiness score = coverage (articles per category ÷ tickets per category) + freshness (median days since review) + usage (views and helpful ratio) + grounding rate (share of AI answers that cite an article). Show the gaps per category with a "create article" call to action.
- Make snippets first-class records (question, answer, source, audience) and index them with articles. Apply audience and ACL filters *before* retrieval.

## Module: cmdb

### Features
- **Impact analysis with redundancy** — iTop relations ("impacts" / "depends on") are declared in the data model. The impact graph walks them. Redundancy settings on groups (e.g., a farm counts as down only when N of M members are down) stop false propagation. [iTop]
- **Flow class** — iTop 3.3.0 models data flows between functional CIs; flags on each flow instance decide whether impact propagates along it. The release also adds dynamic logos in impact graphs (per category, software or instance), more prominent impact analysis on object views, a Cloud class and container-management classes. [iTop]
- **Synchro Data Sources** — iTop collectors (vSphere, AD, OCS, CSV and others) load replica tables. The synchro engine reconciles them into CIs using reconciliation keys, per-attribute update policies (write / read-only / locked) and deletion policies. [iTop] (from knowledge)
- **Audit rules** — iTop audit categories hold OQL rules that list non-compliant objects (e.g., servers without an owner) and show a compliance %. [iTop]
- **AI assets and Digital assets CI families** — InvGate's AI-asset CIs cover AI agents, models, MCP servers, skills, plugins and marketplaces, each with an owner, lifecycle status and links to devices, people and business apps, so impact analysis covers AI components. Digital assets cover automation workflows and certificates. [InvGate] [AI]
- **Network source of truth** — NetBox models sites, regions, locations and racks (elevations); devices from a device-type library; modules, interfaces and cables (with tracing; cable profiles and advanced port mappings in 4.5); power; circuits; IPAM (VRFs, prefixes, ranges, IPs, VLANs, ASNs); virtualization; tenancy; contacts; wireless and VPN. Config contexts are hierarchical JSON merged by site, role and platform (schema-validated since 4.4), rendered through Jinja2 config templates. [NetBox]
- **Assurance and discovery add-ons** — NetBox Labs Discovery is agent-based discovery. Assurance flags drift between the intended state in NetBox and the operational state. [NetBox Labs] (details unverified)
- **Discovery merged into one device view** — Ivanti shows discovered devices in the main Devices view, with RBAC on Discovery, and ITSM shows a Device Sync Status. [Ivanti]
- **Trust-based CI support** — A Xurrent account can give support of its CIs to teams of a trusted MSP account, if the CI's financial owner allows it. [Xurrent]

### Implementation notes
- Give each relation type `direction` and `propagates` flags, and give group nodes `min_up` or `%`. A group is impacted when impacted members > total − min_up. Cache the transitive closure and invalidate it when relations change.
- Store provenance per attribute (`source`, `last_seen`, `locked`) to support reconciliation, and GLPI-style locked fields that inventory must not overwrite.

## Module: itam

### Features
- **Check-in/check-out ledger** — Snipe-IT assets check out to a user, a location or another asset, with an expected check-in date. Licence seats go to users or assets, components are installed into assets, accessories go to users (newer versions also to locations and assets, unverified), and consumables are issued to users and never returned. Every movement is logged, and bulk checkout is supported. [Snipe-IT]
- **EULA acceptance** — A Snipe-IT category can require acceptance. The user is emailed, accepts or declines with a signature, and the acceptance PDF is stored. A report lists unaccepted assets. [Snipe-IT]
- **Licences, accessories, consumables, components** — Licences are tracked by seats (checked out to users or assets) with expiration and termination dates and a reassignable flag. Accessories are reusable items with quantities. Consumables are depleted on checkout. Components are installed into assets. All have minimum-quantity alerts. [Snipe-IT]
- **Audits and depreciation** — Each Snipe-IT asset has a last-audit and next-audit date (from an interval), with due and overdue lists and tag/QR scanning. Depreciation is straight-line over N months with a floor value, plus EOL months per model. [Snipe-IT]
- **Physical audits with RFID** — In InvGate you scope an audit to a location and scan with a phone camera or RFID reader. Results reconcile into Found / Pending-Missing / Others, and closing the audit stamps each asset with date, location and result. [InvGate]
- **Atlas AI Agent** — Supplies EOS/EOL dates and suggests missing owner, location and financial fields from signals in the environment, with its reasoning shown. Confirmations are logged on the asset, and a Data Completeness screen tracks quality over time ("coming soon"). [InvGate] [AI]
- **Inventory agent** — The GLPI Agent does local inventory, network discovery (SNMP/NetBIOS/ARP), SNMP network inventory, ESX inventory, software deployment, Wake-on-LAN and "collect" (registry, WMI, files). Import rules decide whether to create, link or refuse objects. [GLPI]
- **Agent and agentless discovery** — InvGate agents run on Windows, Linux, macOS and Android without admin rights. A proxy scans via SNMP, WMI, SSH and NMAP. [InvGate]
- **Device context and remote actions in the ticket** — Zendesk ITAM (GA May 2026) shows owner, location, warranty and condition in the ticket, and can remote lock or erase a compromised device through MDM. [Zendesk]
- **RMM-sourced inventory** — In Atera and Ivanti Neurons, assets come from the management agent (hardware, software, patches, alerts) and drive both tickets and remediation. Ivanti adds a "Licensable Software" tab that counts licensable titles imported from Neurons. [Atera, Ivanti]

### Implementation notes
- One polymorphic table: `checkout(item_type, item_id, qty, target_type user|location|asset, target_id, out_at, expected_in_at, in_at, acceptance_id)`. Consumables never check in. Available = quantity − open checkouts.
- An audit session = expected set (assets at a location) vs scanned set, producing a diff. On close, write `last_audit_*` on each asset and set `next_audit_at = last + interval(category)`.

## Module: slm

### Features
- **Affected SLAs (several SLAs per request)** — Xurrent automatically adds small "affected SLA" records to a request, one for each SLA it can count against. That includes the provider SLA and the SLAs of supplier service instances lower in the service hierarchy. Each record stores actual response and resolution durations, downtime and its own targets. *Accountability* is `provider` (same service instance), `supplier` (an instance lower in the hierarchy) or `sla_not_affected` (responsibility moved away). Service instance, support team and first-line team are copied when the record is created. Targets = start time + maximum durations, computed in the support-hours calendar. A response counts as given when the request moves to In progress, Waiting for, Workflow pending or Completed, leaves the service instance, or is assigned to a team other than the first-line or support team. [Xurrent]
- **First Line Support Agreements (FLSA)** — Between trusted Xurrent accounts, one account runs the service desk for the other's customers. [Xurrent]
- **OLA breach thresholds** — Halo allows up to three thresholds per OLA, as % of time elapsed or working hours remaining. Each can fire notifications, webhooks or runbooks, and trigger times are recalculated when the OLA is paused and resumed. [Halo 2026]
- **Billable SLAs** — Effort classes on a Xurrent service offering decide which rate classes appear when people log time against service instances it covers. [Xurrent]
- **Grace-period SLA plans** — An osTicket SLA plan is a grace period in hours plus a schedule, attached to help topics or departments. [osTicket]

### Implementation notes
- Use a table `affected_sla(request_id, sla_id, service_instance_id, accountability, response_target_at, resolution_target_at, responded_at, resolved_at, downtime, breached_*)`. Recompute when the service instance or assignee team changes. Moving work to a supplier team closes the provider's response clock and starts the supplier's, so one request is measured from both viewpoints.

## Module: service_portfolio

### Features
- **Service hierarchy via service instances** — In Xurrent a Service (logical) has Service Instances (deployments, e.g., "E-mail – EU production") linked by "supported by" relations, which form a hierarchy that can span accounts. Service offerings carry targets, charges and effort classes. An SLA covers a customer for an offering on a specific instance. [Xurrent]
- **Contract-based catalog** — iTop: service families → services → service subcategories (by request type). Customer contracts link organizations to services and SLAs; provider contracts link suppliers. SLAs contain SLTs per priority and ticket type. [iTop] (from knowledge)

### Implementation notes
- Keep "service" (logical) separate from "service instance" (the deployment that CIs, teams and SLAs attach to). The applicable SLAs for a request = requester's organization × selected service instance × the offerings covering it.

## Module: event

### Features
- **On-call with AI scheduling** — Xurrent IMR (formerly Zenduty) provides schedules, escalation policies and alert routing. AI Scheduling proposes shift plans that weigh time zones, recent workload and upcoming PTO. Sera AI builds rotations from natural-language descriptions. AI correlation suppresses duplicate and low-priority alerts. [Xurrent IMR] [AI]
- **Event rules with RBAC** — Halo event management rules turn monitoring alerts into tickets, and can be restricted by role, agent or team. [Halo]
- **Monitoring products feeding ITSM** — EasyVista EV Observe (infrastructure monitoring and observability) and Atera's RMM threshold profiles raise alerts that can auto-create tickets or run scripts. [EasyVista, Atera]
- **Neurons Bots** — Ivanti bots detect and remediate endpoint issues (performance, configuration, security), can create or update ITSM tickets as a bot stage, and can be triggered from the API hub. Neurons Workspace custom actions are being replaced by the new Neurons Bots experience. [Ivanti]

### Implementation notes
- Deduplicate alerts on hash(source, check, resource, severity bucket) in a sliding window. Correlate by CMDB neighbourhood + time + text similarity, and open one incident per correlated group.

## Module: security

### Features
- **Risk Detection** — SolarWinds matches software discovered on managed computers against known CVEs and lists "risks" by severity, which can become incidents or changes. [SolarWinds] (unverified details)
- **Patch Intelligence with risk data** — Ivanti merges missing patches with its risk data: advisories, CVE counts, VRR group and score, and exploited CVEs. [Ivanti]
- **Framework-aligned GRC risk categories** — Ivanti's risk category hierarchy is aligned to NIST RMF, NIST CSF 2.0, ISO 31000 and COSO ERM, with executive and operational risk reporting. [Ivanti 2026.1]
- **Secure-by-default profile** — New Ivanti installs ship a stricter profile. For example, a request offering appears in Self Service search only for users in its configured org or role. Admins can also disable password change for SSO users. [Ivanti 2025.x]
- **Security Incident quick action** — Ivanti chat creates security incidents alongside work orders and HR cases. [Ivanti]
- **Device lock and wipe from the ticket** — Zendesk ITAM. [Zendesk]
- **Caller verification** — Halo Security Questions (see Module: incident). [Halo]

### Implementation notes
- Vulnerability matching: normalize software to CPE-like identifiers, match against CVE version ranges, dedupe per (asset, CVE), and close a risk automatically when the software disappears from inventory. Feed the open risk count of affected CIs into the change risk score.

## Module: supplier

### Features
- **Account trusts (SIAM)** — Only a Xurrent Account Administrator can maintain trusts. Two accounts that trust each other can register SLAs and FLSAs, offer their roles to the other's people (e.g., Service Desk Analyst), receive tasks and project tasks (optionally limited to named teams) and take on support for CIs. A trust grants nothing on its own; roles must still be assigned. [Xurrent]
- **Directory vs support-domain accounts** — One directory account holds people, organizations and sites. Separate support-domain accounts (IT, HR, Facilities) share it, so each domain has its own configuration on one person base. [Xurrent] (from knowledge)
- **Tool-to-tool e-bonding** — Halo has integrated with Alemba (Q1 2025), SailPoint IdentityNow and AssetBots (2026). [Halo]

### Implementation notes
- Represent tenants as accounts with `trust(a, b, allowed_team_ids[], shared_role_ids[])`. Data stays in the owning account; the other side sees records only through assignment to its permitted teams. Check that the trust and team are allowed on every cross-account assignment.

## Module: financial

### Features
- **Contracts and billing (PSA heritage)** — Halo contracts have billing plans (recurring invoices, prepaid hours or amounts, block hours), charge rates per labour type, invoice generation and accounting sync (e.g., Xero, QuickBooks). [Halo] (unverified details)
- **Effort classes and time allocations** — Xurrent time entries carry an effort class (rate category). Time allocations cover non-ticket work and can carry a default effort class. A billing integration exports billable time per service offering. [Xurrent]
- **Refresh and depreciation dashboard** — InvGate's 16-component dashboard shows book value, depreciation, refresh spend, cost-center splits and devices due for replacement. Two Smart Tags, "Flagged for decommission" and "Overdue retirement", drive it, and it respects user permissions. [InvGate]
- **Portfolio budgets** — Ivanti PPM tracks available vs allocated budget and demand budget estimates. [Ivanti]
- **Asset financials** — GLPI stores per-asset purchase, warranty, amortization type and period, and TCO. Snipe-IT handles depreciation. [GLPI, Snipe-IT]

### Implementation notes
- Prepaid contract = a balance ledger `contract_txn(contract_id, delta, source time_entry|invoice|adjustment)`. Billable time debits the ledger according to rules (labour type, out-of-hours multiplier). Recurring invoices are generated by schedule with proration.

## Module: project

### Features
- **PPM inside ITSM** — Ivanti covers demands (with a Resource Estimated Effort field), portfolios, projects and phases, and resource plans. Setting a resource plan to Completed or Closed locks it. Resources roll up from phases to projects, the owner or sponsor is emailed when a project is at risk or off track, and there is a Demand Manager role. [Ivanti 2025.4/2026.1]
- **Gantt across tickets, agents and projects** — Halo shows Gantt charts in ticket, agent and project views. GLPI projects have tasks, Gantt, Kanban and costs. Xurrent project tasks can be assigned to teams of trusted accounts. [Halo, GLPI, Xurrent]

### Implementation notes
- Roll effort up from tasks to phases to project, and lock resource plans in terminal states (Completed/Closed) as Ivanti does, so baselines are kept. Link projects back to the demand that started them and forward to the changes or requests that deliver them.

## Module: workforce

### Features
- **Task Board** — TOPdesk's cross-module Kanban of operator tasks. The Assignee filter (Aug 2025) shows the tasks of other operators and operator groups. February 2025 added filters for operator, operator group and branch on calls and operational activities. [TOPdesk]
- **Timesheets** — Xurrent organization-level timesheet settings, effort classes and time allocations. Zammad time accounting with activity types. [Xurrent, Zammad]
- **On-call** — AI-proposed rotations in Xurrent IMR (see Module: event). [Xurrent]
- **Live chat alerts** — Halo raises browser notifications on "New Live Chat Request". [Halo]

### Implementation notes
- A Task Board is a cross-module query (`assignee in (me, my groups)` over tickets, tasks and operational activities) shown as Kanban by status. Save the filters (assignee, operator group, branch) per user. For on-call, model `schedule → layers → rotations → overrides` and resolve who is on call at a given time. An AI proposer only fills a draft layer, which a human approves.

## Module: portal

### Features
- **AI-first portal home** — InvGate's portal has four zones: pending actions, open requests, catalog categories and an Assistance Bar. The Virtual Service Agent and instant answers sit at the top, and each answer cites its article or snippet. [InvGate] [AI]
- **TOPdesk Robin and AI Search** — Robin answers end users in the Self-Service Portal (Oct 2026). AI Search helps them find answers (Apr 2026). [TOPdesk] [AI]
- **Page Designer and anonymous access** — Ivanti Self Service V3 has a page designer. Custom landing pages control anonymous access to offerings and KB articles. Truncated descriptions get a More link. [Ivanti]
- **Deflecting Teams bot** — Ivanti's Teams bot suggests KB articles and FAQs (paginated) before a ticket is created. It is localized and uses Teams task modules for forms. [Ivanti] [AI]
- **Portal without seats or licences** — monday service lets anyone submit, track and search without a monday account. Alemba's portal is licence-free, with per-department or unified views. [monday, Alemba]
- **Auto-translated portal** — Halo translates the portal with Azure AI Translator (Q4 2025). [Halo] [AI]
- **Chat-native intake** — Siit, Rezolve.ai, Atomicwork, Moveworks and Leena AI take requests in Slack/Teams channels or DMs, answer from Notion/Confluence/SharePoint, and let agents work inside the thread. [AI-native] [AI]
- **ITSM inside Microsoft Copilot** — EasyVista's EV chatbot creates, updates and manages tickets in natural language within Copilot chat (2025.3). [EasyVista] [AI]
- **Screenshot-to-ticket** — SMAX Smart Ticket. [OpenText] [AI]
- **Organization-wide portal visibility** — iTop's "Portal power user" sees every ticket of their organization; a "Portal user" sees only their own. [iTop]

### Implementation notes
- The instant-answer box runs retrieval over snippets and articles, filtered by audience, before showing the catalog. "Didn't help" opens the best-matching form with the query prefilled and records a failed deflection for KB gap analysis.

## Module: esm

### Features
- **Reservations** — TOPdesk reserves rooms, objects and services (e.g., catering), with availability and approval. Asset-overview filters show what can or cannot be reserved (Feb 2025). GLPI reserves items such as projectors. [TOPdesk, GLPI] (TOPdesk details partly from knowledge)
- **Operations Management (planned activities)** — TOPdesk generates recurring operational activities (backups, checks, maintenance rounds) from schedules, assigns them to operators or groups, and filters them by branch. [TOPdesk] (details from knowledge)
- **Facilities and visitors** — TOPdesk runs facility requests and visitor registration on the same card engine as IT. [TOPdesk] (from knowledge)
- **Employee Service AI Agents** — Zendesk agents handle multi-step IT, HR and workplace requests (onboarding, access approvals, laptop lifecycle) by acting in identity, asset and workflow systems. [Zendesk 2026] [AI]
- **One agent per department** — InvGate Agent Studio gives IT, Purchasing and HR their own agents, each with its own knowledge scope and channels. [InvGate] [AI]
- **Domain accounts sharing one directory** — Xurrent's support-domain accounts (see Module: supplier). [Xurrent]
- **Proactive lifecycle nudges** — Leena AI pushes reminders and recommendations on employee lifecycle events such as onboarding. [Leena AI] [AI]

### Implementation notes
- Reservations need a resource calendar with conflict checks (overlapping bookings per item, buffer times), approval rules and optional linked service orders (catering, AV) that become tasks. Operations Management is recurrence rules (RRULE) that create activity records a fixed horizon ahead. Editing a series changes only future occurrences that have not started.

## Module: csm

### Features
- **Multi-client hierarchy** — Halo uses Customers (clients) → Sites → Users, with per-customer contracts, SLAs, ticket types and branding. "Top Levels" group customers for segmentation and agent restriction. [Halo] (unverified details)
- **MSP models** — Atera nests customers → sites → devices, with per-customer alerts and portal. Xurrent service-provider accounts serve customer accounts through trusts. [Atera, Xurrent]
- **Omnichannel open-source helpdesks** — Zammad covers email, chat, phone/CTI, WhatsApp, Telegram, SMS and forms, with customers in several organizations. osTicket routes by help topic. [Zammad, osTicket]
- **Intake filters** — osTicket filters match email or web fields and then reject, set department, priority or SLA, or assign. Znuny postmaster filters set ticket attributes from email headers. [osTicket, Znuny]

### Implementation notes
- Multi-client = `customer → site → user`, with `customer_id` on every ticket, contract and asset. Each agent has an allowed-customers list (or Top Level group) that limits what they see. Intake filters are ordered rules (sender domain, subject or form fields → set customer, department, priority or SLA, or reject) evaluated before the ticket is created.

## Module: analytics

### Features
- **SQL report builder with published schema** — Halo reports can be written as SQL against a documented schema or built in the Query Builder. Since Q1 2024 an AI assistant in the report builder turns natural language into queries over the whole database. The 2026 release enforces KB permissions in reports and can schedule reports to distribution lists. [Halo] [AI]
- **AI Insights email** — Every Monday morning, in each AI admin's time zone, SysAid emails an AI summary of KPIs with recommended actions. An AI Usage Dashboard shows usage and time saved per feature. [SysAid] [AI]
- **Workflow Assistant** — InvGate explains any workflow stage by stage in plain language, with six months of execution data (runs, average lifecycle time, slowest stage). [InvGate] [AI]
- **Clusters and Hot Topics as analytics** — Halo's archived cluster runs and SMAX Hot Topics support trend reporting. [Halo, SMAX] [AI]
- **Query languages** — iTop OQL dashlets and audit compliance; RT TicketSQL charts and dashboards. [iTop, RT]

### Implementation notes
- Run natural-language-to-SQL against permission-filtered views of the requesting user, never against base tables. This is the lesson of Halo's KB-permission enforcement. Validate generated SQL as read-only, cap row counts and log the prompt with the SQL.

## Module: ai

### Features
- **Governance console** — Alemba lets admins switch each AI capability on or off, logs every AI action and keeps final decisions human. SysAid gates all Copilot configuration behind an "AI Admin" permission. TOPdesk lists features in AI settings as plan and rollout allow, at no extra cost. [Alemba, SysAid, TOPdesk]
- **Per-action autonomy** — InvGate Agent Studio sets each agent action to run automatically, ask for confirmation or never run. Autonomy can be widened gradually. On handoff the agent writes an internal comment summarizing what it already checked. [InvGate]
- **Agents with an application identity** — A Halo AI Agent step authorizes as a chosen Halo Application, which defines its identity and permissions. It uses the same functions as Halo's MCP server: ticket retrieval, KB search and adding actions. [Halo]
- **AI provenance flags** — Halo marks AI-created tickets, actions and KB articles and records the creating Virtual Agent, AI Agent or MCP Tool Collection. [Halo]
- **MCP servers** — TOPdesk's is read-only and scoped to the customer's own data. InvGate's has nine read-only tools and per-user revocable tokens that inherit the user's permissions, with ready configs for Claude Desktop/CLI, Cursor, VS Code, Gemini CLI and Codex CLI. Xurrent's open MCP server makes external agents inherit the "Shared Policy and Data Layer", with the same audit as native agents. Atomicwork exposes its ITSM via MCP. [multiple]
- **Model choice** — Zammad supports local LLMs via Ollama. Ivanti translation engines are swappable. Xurrent's MCP server lets customers bring OpenAI, Google, Anthropic or in-house models. [Zammad, Ivanti, Xurrent]
- **Feedback loops** — Zammad like/dislike with an optional comment to admins. SysAid Monitor & Fine-Tune for Q&A sets. [Zammad, SysAid]
- **Agent builders** — SysAid AI Agent Builder (no-code, 100+ prebuilt agents), InvGate Agent Studio, Rezolve.ai Creator Studio (describe the automation in words), Xurrent Sera AI Studio (unverified), IFS/TheLoops agent builder with MCP and human approval points, Moveworks agent building tools. [multiple]
- **AI workflow generation** — In InvGate, admins describe a process in plain language. The AI asks clarifying questions, returns an editable stage plan, then generates a workflow (stages, conditions, variables) to finish in the editor. [InvGate]
- **Pricing models** — Included (Xurrent Sera AI in all tiers, TOPdesk AI settings, InvGate AI Hub), per call (Zammad, €0.03 per call pre-release), or add-on (Ivanti AI package and Agentic AI licence). [multiple]

### Implementation notes
- `ai_action_log(id, agent_id, run_as_identity, tool, input_ref, output_ref, policy auto|confirm|never, decision, approver_id, at)`, linked to the affected records. Policies are per tool and can have conditions (e.g., auto only when confidence ≥ 0.8 and requester is not a VIP).
- Every MCP or agent tool call runs as a real principal (user token or a scoped service "application") through the normal permission layer, read-only by default, never as a superuser.

## Module: access

### Features
- **Permission groups with filters** — TOPdesk permission groups grant module rights, and filters (category, branch, operator group, budget holder) restrict which cards an operator sees. Permission groups can be assigned in bulk to operator groups. [TOPdesk] (filter list partly from knowledge)
- **Entity tree** — GLPI entities form a hierarchy. Rights are (profile, entity, recursive) triples, objects marked recursive are visible in sub-entities, and settings inherit down the tree. [GLPI]
- **Organization silos plus profiles** — iTop "allowed organizations" (including children) filter every query, while profiles grant class actions and lifecycle stimuli. See the section "Access control & org structure". [iTop]
- **Constraint-based object permissions** — NetBox permission = object types + actions + JSON attribute constraints (e.g., `{"tenant__slug": "acme"}`). Object Ownership arrived in 4.5. [NetBox]
- **Fine-grained queue/group rights** — Znuny ro/move_into/create/note/owner/priority/rw per group; RT rights per role at global, queue, custom-field or catalog level; Zammad full/read/create/change/overview per group. [Znuny, RT, Zammad]

### Implementation notes
- Compile every permission into a query predicate: NetBox JSON constraints → ORM filters; GLPI (entity, recursive) → `entity_id IN subtree`; iTop silos → `org_id IN allowed+descendants`. Use one predicate builder for lists, search, reports, exports, RAG retrieval and MCP tools, so no channel can leak data.

## Module: integration

### Features
- **Integration runbooks with logs** — Halo runbooks show a request/response log per step and can be triggered by a "Ticket Type Group" condition. [Halo]
- **iPaaS** — Xurrent and Ivanti offer embedded iPaaS. [Xurrent, Ivanti]
- **Event rules and webhooks** — NetBox event rules call a webhook or custom script on object changes, running as background jobs. GLPI 11 and Zammad both have webhooks. [NetBox, GLPI, Zammad]
- **GenericInterface** — Znuny's SOAP/REST provider and requester with field mapping and event-driven invokers. [Znuny]
- **Identity and Microsoft 365** — Ivanti imports from Entra ID with group filters, syncs calendars through Microsoft Graph and moved to OAuth 2.0 app registration. Znuny 7.2 adds Graph mail and the OAuth2 client-credentials flow. Halo integrates SailPoint IdentityNow. [multiple]

### Implementation notes
- Log the request and response of every outbound step, with secrets redacted, viewable per run step as in Halo. Event rules enqueue jobs with retries and idempotency keys. Sign webhooks with HMAC.

## Module: admin

### Features
- **Staged AI rollout** — A TOPdesk feature appears in AI settings when it reaches the customer (rollout takes 4–5 weeks) and their plan allows it. [TOPdesk]
- **Upgrade-safe customization** — SMAX codeless configuration, Ivanti Soft Lock and iTop deltas. [multiple]
- **Marketplaces** — GLPI plugin marketplace installed from the UI, iTop Hub extensions, EasyVista EV Marketplace (Apr 2025). [GLPI, iTop, EasyVista]
- **Explicit LTS lifecycle** — Znuny publishes end-of-life dates per line (7.1 EOL 19-Aug-2025; 7.2 EOL 25-Mar-2026). [Znuny]
- **Localization at platform level** — Ivanti added Malay, Hebrew (SS V3), Catalan and Canadian French cultures, plus custom language files. [Ivanti]

### Implementation notes
- Gate each AI capability per tenant three ways: plan, rollout stage and admin toggle. Show them all on one AI settings page that explains why a feature is unavailable (plan or rollout).

## Module: devops

### Features
- **NetBox as intended state** — Config contexts and Jinja2 config templates render device configurations. Change logs carry comments (4.4), v2 API tokens arrived in 4.5, and REST, GraphQL and custom scripts feed automation pipelines such as Ansible. The NetBox Branching add-on stages changes before merging them (unverified). [NetBox]
- **SRE incident response** — Xurrent IMR links alerting and on-call to incident response alongside ITSM. [Xurrent]
- **Issue-tracker links** — Zammad links tickets to GitHub and GitLab issues. [Zammad]

### Implementation notes
- When CMDB data drives automation, keep a change log with author and comment for every write, offer branch-and-merge staging for bulk edits, and issue API tokens with scopes, expiry and versioning.

## Access control & org structure

- **Ivanti** — Roles × business-object permissions (view/add/edit/delete), with Teams and Organizational Units as the org model. Self Service request offerings are visible only to configured orgs or roles (secure default since 2025.2). KB collections are filtered by object permissions in Teams, and Discovery has its own RBAC. A named "row-level security" feature could not be verified; record scoping comes from role/BO permissions plus org-unit/team conditions (unverified). Agentic AI is a licensed, feature-flagged SaaS add-on. Whether its agents act as the end user was not documented in what I read.
- **TOPdesk** — Operators belong to operator groups. Permission groups (assignable in bulk to operator groups) grant module rights, and filters (branch, category, operator group, budget holder) limit which cards are visible. Callers belong to branches (sites) and departments. AI uses only data "explicitly made available", is not trained on customer data, and the MCP server is read-only and scoped to the customer's data.
- **Xurrent** — Multi-account tenancy: one directory account plus support-domain and provider accounts. Trusts (maintained by the Account Administrator) allow cross-account SLAs, FLSAs, role sharing and task assignment to named teams. Roles are per account (e.g., Specialist, Service Desk Analyst, Account Administrator, Auditor). External agents connected through MCP inherit the same "Shared Policy and Data Layer" and audit trail as native agents and human users.
- **Halo** — Agent roles plus per-object restrictions by role, agent or team (event rules, custom fields, AD config, approval groups). A customer → site → user hierarchy, with "Top Levels" for multi-client segmentation (unverified). AI Agents run as a chosen Halo Application, which carries their identity and permissions. Reports enforce KB permissions, and Security Questions verify callers.
- **InvGate** — Per-user MCP tokens inherit the user's permissions and are self-revocable. Dashboards respect permissions. Agents have per-action autonomy (auto/confirm/never) and their own knowledge scope.
- **SysAid** — The "AI Admin" permission gates Copilot configuration. Admins control what the chatbot and agents may do and which data (Data Pool) they can reach.
- **iTop** — Profiles (from `profiles.xml`): Configuration Manager, Service Desk Agent, Support Agent, Problem Manager, Change Implementor, Change Supervisor, Change Approver, Service Manager, Document author, Portal user, Portal power user, plus read-only profiles (Configuration, Ticket, Service Catalog) and SuperUser/Administrator. Profiles grant per-class actions and lifecycle stimuli. "Allowed organizations" (hierarchical silos) filter every query.
- **GLPI** — Entity tree. Rights are (profile, entity, recursive) triples, and objects can be recursive into sub-entities. Authorization rules map LDAP/SSO attributes to profile and entity. There are separate simplified (self-service) and standard interfaces.
- **Znuny / RT / Zammad** — Znuny: group permission types (ro, move_into, create, note, owner, priority, rw), roles, customer-user groups, and ACLs that narrow options per context. RT: rights granted to groups and roles (including custom roles) at global, queue, custom-field and catalog level. Zammad: per-group access levels plus role permissions such as `admin.ai_agent`.
- **NetBox** — The model to copy for row-level security. A permission is object types + actions + JSON constraints compiled into query filters, assigned to users or groups. Tenancy and Object Ownership (4.5) add scoping. v2 API tokens arrived in 4.5.
- **Snipe-IT** — Full Multiple Companies Support scopes users and items to a company. Permission groups grant rights per module.
- **AI-native desks** — Enterprise search must honour source ACLs at query time (Moveworks, Unleash/Zendesk). Actions run through IdP or ITSM connectors under service identities with policy checks and in-chat approvals. Atomicwork's TRUST framework and Leena AI both cite RBAC and guardrails.

Builder takeaways: (1) compile permissions to query filters (NetBox constraints, GLPI entity trees, iTop silos) and apply them inside retrieval for RAG and NL-to-SQL; (2) give AI agents a real principal (Halo "Application", InvGate user token) and per-action autonomy; (3) support multi-tenant trusts (Xurrent) for MSP and SIAM scenarios.

## AI capabilities

- **Ivanti** — *Knowledge Search & Incident Deflection* (RAG over configured KBs before ticketing); *Incident Agent* (natural language → incident); *Service Request Agent* (prompt → matching template → submitted request); *Q&A Service* (answers status questions about the user's incidents); *Live Agent Handoff* (configurable transfer to a human); *Self-service agent* (persona-based, on the Conversational AI Framework, controlled release Apr 2026); *Business Object Summarization* (summaries for any BO, including custom ones); *Write Assist / Email Assist* (improves field text, drafts emails); *Field-level and Workbench translation* (detects UI language; OpenAI, Google, DeepL or Azure); *Improved and semantic search* (partial/related terms; vectors in preview); *Incident Correlation* (clustering with boundary and keyword exclusions); *Teams bot deflection* (KB/FAQ suggestions before ticketing).
- **SysAid** — *AI Chatbot* (LLM over the Data Pool; creates Service Records from chat); *AI Emailbot* (emails the AI answer back to email-submitted records); *AI Agents and Agent Builder* (100+ prebuilt plus no-code custom agents, triggered from chat, calling external apps); *Intelligent Categorization* (Category Set from title and description, with an escalation rule); *Case Summarization* (hover summary); *AI Emotion* (live sentiment); *AI Author* (tone rewrite); *AI Insights* (weekly KPI digest with recommendations); *Monitor & Fine-Tune* plus *Usage Dashboard* (AI quality and ROI).
- **Halo** — *AI Ability* (prompt step mapping variables to JSON outputs); *AI Agent* (multi-step tool-using agent running under an Application identity); *Ticket clustering* (embeddings plus AI-written cluster description and resolution); *AI ticket linking*; *Report AI assistant* (NL → query over the whole database); *Portal translation* (Azure AI Translator); *Virtual Agent* and *MCP tool collections*; *AI provenance flags*.
- **TOPdesk** — *AI Categorization*; *AI Triage* (category, priority and operator group suggestions); *AI Summarization*; *AI Knowledge Item Creation*; *AI Writing Assistant* (knowledge and incident replies); *AI Answer Assistant* (KB-grounded reply suggestion); *AI Search* (portal); *AI Translation* (whole ticket into the operator's language); *AI Readiness Dashboard* (scores KB volume, freshness and use); *TOPdesk Robin* (portal answers plus operator help: summarize, draft, fix → knowledge); *MCP* (read-only access for Copilot, Claude and ChatGPT).
- **Xurrent** — *Sera AI* (classifies requests, drafts articles, resolves routine tickets; in every tier); *Autonomous agents* (triage, knowledge work, closure end-to-end under human guardrails, every action audited); *Open MCP server* (any model inherits Xurrent policy and audit); *Sera AI Studio* (virtual agent configuration, unverified); *IMR AI scheduling* (shift plans weighing time zones, workload and PTO); *AI alert correlation* (suppresses duplicates); *natural-language rotations*.
- **OpenText SMAX** — *Smart Ticket* (OCR of screenshots/emails plus ML classification and routing); *Smart Email*; *Hot Topic Analytics* (IDOL clustering for root cause and trends); *Smart Search* (federated IDOL search, from knowledge); *IT Operations Aviator* (private GenAI assistant for agents).
- **EasyVista** — *EV Pulse AI Conversations* (LLM chatbot); *EV chatbot in Microsoft Copilot* (ticket CRUD by chat); *ticket summarization* (2025.3, secondary source); *node-based knowledge for AI*.
- **InvGate** — *Virtual Service Agent and instant answers* (cited snippets and articles); *Autonomous Agents / Agent Studio* (per-department agents, per-action autonomy, summarized handoff); *AI workflow generation* (chat → stage plan → workflow); *Workflow Assistant* (explains a workflow plus 6-month execution stats); *Atlas AI Agent* (EOL data and suggested missing asset fields with reasoning); *MCP server* (read-only, per-user tokens); *AI Hub suggestions* (answers, routing, knowledge generation).
- **Zendesk** — *Employee Service AI Agents* plus *Advanced Action Flows* (multi-step onboarding, access and device tasks via Okta, Entra ID, Jamf and Intune); *Intelligent triage* (intent, sentiment and language → routing); *Copilot* (agent assist, from knowledge); *Unleash enterprise search*.
- **SolarWinds** — *Virtual agent*; *Guided incident resolution* (similar tickets and KB suggestions); *AI tone enhancer* (shorthand → polished reply); *AI Incident Correlation* (groups incidents → problem); *AI KB generation* (from common solved incidents); *AI chatbot with its own admin controls* (unverified).
- **Atera** — *AI Copilot* (technician assistant: scripts, troubleshooting, summaries, actions); *IT Autopilot* (autonomous end-user agent for resets, reboots and routine requests, escalating when approval is needed); *Robin* (autonomous agent running on the employee's device).
- **IFS assyst** — *TheLoops agentic platform* (reasoning engine, agent builder, orchestration, evals, MCP, human approval points); whether these agents reach assyst is unverified.
- **Alemba** — *Conversational assistant* (preview); *ticket insights*; *AI-drafted emails*; per-capability switches and full AI action logging.
- **monday service** — *AI classification and routing* (type, urgency, sentiment, department); *summaries and tone detection*; *AI service agents* including an *Intake & Triage Agent* (resolve from KB and past tickets, escalate to humans).
- **Zammad** — *AI agents* (background categorization, priority and title edits, visible presence, macro-triggerable); *Ticket summary* (intent, summary, open questions, events, sentiment); *Writing assistant* (expand, fix, halve, simplify, plus custom tools); local LLMs via Ollama.
- **NetBox Labs** — *NetBox Copilot* (natural-language assistant over NetBox data, unverified details).
- **AI-native desks** — *Moveworks* (Reasoning Engine plans and runs plugins across 100+ systems: password reset, access and group provisioning, software requests, approvals in chat, permission-aware enterprise search; ServiceNow-owned since Dec 2025); *Aisera* (conversational AI, conversational RPA, TicketIQ auto-triage; Automation Anywhere, unverified); *Atomicwork Atom* (100+ skills for zero-touch IT, HR and Finance requests across Slack, Teams, email, browser and MCP; agent assist with summaries, resolutions and problem links); *Rezolve.ai* (Agentic SideKick 3.0 in Teams/Slack; Creator Studio builds automations from descriptions); *Espressive Barista* (GenAI virtual support agent; now Resolve); *Serviceaide Luma* (knowledge-centred virtual agent that disambiguates, hands off and schedules calls; Luma Knowledge improvement loop); *Leena AI* (AI colleagues across HR, IT, Finance and Procurement; voice; proactive lifecycle nudges); *Siit* (Slack/Teams AI answers from Notion and Confluence; Pro agents complete password resets and access grants in-thread).

## Differentiators

- **Xurrent** — True SIAM: account trusts, cross-account SLAs, FLSAs and role sharing, plus affected-SLA records that measure provider and supplier on the same request. AI is included in every tier, and the open MCP server carries the same governance.
- **Halo** — PSA-grade contracts and billing inside ITSM, a SQL/Query Builder over a published schema with NL-to-query, AI Agents as runbook steps under an app identity, parallel approval groups, caller security questions and OLA thresholds.
- **TOPdesk** — One card engine for IT, Facilities and HR (reservations, operations management, visitors), permission filters by branch, category and operator group, a fast 2026 AI roadmap with an AI Readiness Dashboard, and a read-only MCP server.
- **Ivanti** — ITSM fused with endpoint management (bots, discovery, Patch Intelligence with VRR), a metadata BO platform with Soft Lock and Clone BO, framework-aligned GRC risk categories, and agentic AI with template-matching request agents.
- **InvGate** — Catalog products tied to live stock, RFID physical audits, AI-asset and digital-asset CI families, per-action autonomy in Agent Studio, and AI workflow generation with execution analytics.
- **SysAid** — The broadest packaged GenAI suite for mid-market (Data Pool, emailbot, emotion, weekly AI Insights, 100+ prebuilt agents).
- **OpenText SMAX** — Codeless, upgrade-safe tailoring, plus IDOL Smart Ticket (screenshot OCR) and Hot Topics.
- **EasyVista** — Guided Self Help decision trees, EV Observe monitoring and ITSM inside Microsoft Copilot.
- **Zendesk** — CX-grade omnichannel and AI agents applied to employee service, with built-in ITAM device actions and Unleash search.
- **Atera** — RMM-native autonomy: Autopilot and the on-device Robin resolve tickets on the endpoint itself.
- **iTop** — Best open-source CMDB modelling: XML deltas, impact analysis with redundancy and the Flow class, synchro data sources and OQL audit rules.
- **GLPI** — Entity tree, a rules engine everywhere, the native inventory agent, and core forms, catalog and custom assets in 11.0.
- **Znuny** — Process management (BPM) plus ACLs that reshape forms by context.
- **Zammad** — Transparent AI agents (history entries, live presence, macro runs), structured summaries and local-LLM support.
- **Snipe-IT** — The cleanest checkout/EULA/audit/depreciation model for physical ITAM.
- **NetBox** — Network source of truth with constraint-based object permissions and config rendering.
- **AI-native desks** — Chat-first "front door" that completes access, password and software requests and approvals in Slack/Teams, with permission-aware enterprise search.

**UX ideas worth copying:** a live AI-presence avatar and status ring on records (Zammad); a hover summary in queues (SysAid); "Cluster Matched Tickets" tabs (Halo); a portal home with an Assistance Bar and cited instant answers (InvGate); sentence-style automation recipes (monday); the AI Readiness Dashboard (TOPdesk); a "new since your last visit" correlation flag (Ivanti); trending and recent services (Halo); a Found / Missing / Others audit reconciliation screen (InvGate); a data-completeness score with AI suggestions that show their reasoning (InvGate Atlas).
