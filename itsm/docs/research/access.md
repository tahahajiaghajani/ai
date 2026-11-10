# Access control, organization structure and data-visibility models in ITSM tools — and the best model to build

## Overview

Access control in an enterprise ITSM product is five problems that every serious tool solves differently:

1. **Identity** — who the user is (internal employee, contractor, external customer/partner/vendor contact, integration, AI agent), how they authenticate (SSO, MFA, sessions) and how they are provisioned and de-provisioned (SCIM, LDAP, HR feeds).
2. **Capabilities** — what a user may do: create/read/update/delete, transition states, assign, approve, export, report, administer, per module, per field.
3. **Data visibility (scope)** — *which* records the capability applies to: own, participant, group, org unit (and subtree), location, company, domain/tenant, all.
4. **Exceptions** — restrictions that override grants (confidential/HR/security records, restricted groups, security levels, domains), and extensions that widen access for a while (delegation, sharing, elevation, break-glass).
5. **Derived surfaces** — reports, search, notifications, exports, APIs, offline replicas and AI assistants must apply exactly the same rules, or they leak.

How the main tools position themselves:

- **ServiceNow** is a *rule engine*: ACL rules (Allow-If and Deny-Unless) evaluated per table, field and operation, reusable Security Attributes, pre-query Security Data Filters, before-query business rules, query ACLs against blind-query inference, Explicit Roles for external users, **Domain Separation** for multi-tenancy (data, process and UI separation with inheritance), user criteria for knowledge/catalog audiences, granular delegation, Access Analyzer and Security Center. Its AI layer adds invocation ACLs, run-as identities (dynamic user or AI user), role masking/filtering, deny-by-default agentic ACLs and Now Assist Guardian.
- **Jira Service Management (Atlassian)** is *scheme-based*: global permissions, reusable permission schemes granted to space roles and security types, work-item (issue) security levels, and a customer-facing model (portal-only customer accounts, organizations, request participants, sharing settings, request-type restrictions). Rovo search/chat/agents are permission-aware and connector permissions sync within a "freshness window".
- **Freshservice** is *role privileges with a scope per privilege* (across workspace, member/observer groups, specific groups, assigned items), plus multi-workspace ESM, restricted workspaces, restricted groups with group-leader approval, departments with heads, requester groups for catalog/KB audiences. Freddy AI Copilot is licensed per role and Copilot Agent actions are policy-gated (Always allowed / Approval required / Blocked).
- **BMC Helix ITSM** uses AR System **row-level security**: each ticket carries dynamic group fields (Submitter, Assignee, Assignee Group field 112 holding user/support-group/company IDs, parent-group fields) evaluated in the data layer; multi-tenancy via Company; permission groups + functional roles; selectable data access model (support group vs support group and company).
- **ManageEngine ServiceDesk Plus** uses technician roles plus a *view scope* (All, associated accounts, associated sites, group & assigned, assigned only) and **sites** that carry their own SLAs and business rules.
- **TOPdesk** uses permission groups linked to operators/operator groups plus **filters** (branch, category, operator) that narrow visible records.
- **HaloITSM** uses roles that bundle permissions with department/team membership, plus agent restrictions by ticket type and client.
- **Ivanti Neurons for ITSM** has a role chosen at login, business-object/field/relationship rights and *data segregation constraints* through the Employee object and hierarchies (org unit, team/department, geography, cost center); the most permissive right wins.
- **GLPI** uses an **entity tree** with profiles assigned per entity, optionally *recursive*; dynamic assignment rules from LDAP/mail/inventory; per-profile lifecycle (state-transition) matrices.
- **iTop** uses an organization tree with **allowed organizations (silos)** per user and profiles whose rights include lifecycle *stimuli*.
- **Znuny/OTRS** uses groups with permission types (ro, move_into, create, note, owner, priority, rw), roles, queues and an **ACL module** that restricts the selectable options (queues, states, priorities, dynamic-field values, actions) based on the form's current or saved values.
- **Reference platforms outside ITSM** that ITSM builders copy: Microsoft Dataverse (business-unit depth access levels User / BU / Parent-Child BU / Organization, owner and access teams, hierarchy security, field security profiles), Salesforce (org-wide defaults, role hierarchy, sharing rules, restriction rules, permission sets with muting), the Zanzibar family (OpenFGA, SpiceDB) for relationship-based access, Cedar/OPA policy engines, and PostgreSQL row-level security.

How this report is organised: the module sections record what each tool does (features) and how to build it (implementation notes); the closing section **Access control & org structure** compares the tools side by side, maps them to the general models (RBAC, ABAC, ReBAC, OBS/RBS trees, SoD, delegation, break-glass, SSO/MFA/SCIM), compares how AI products enforce permissions, and gives the **final recommendation for our app** (entities, scope levels, record rules, field-level security, the SQL-predicate evaluation algorithm, the optional MSP domain layer, the offline desktop replica, defaults per persona, and how the AI layer must enforce it). **AI capabilities** and **Differentiators** close the report.

### Latest releases and editions relevant to access (as of 2026-11-07)

| Product | Latest line | Access/AI-security notes |
|---|---|---|
| ServiceNow | **Brazil** (feature early availability 2026-09-24; Brazil Patch 2 released 2026-11-05 and listed as available to all users); **Australia** (H1 2026, Patch 5b in Q4 2026); **Zurich** (H2 2025); Yokohama still patched | Australia/Brazil docs: Deny-Unless + Allow-If ACLs, query ACLs auto-loaded by most platform plugins (Australia EA), deny-by-default for the agentic ACL types on freshly reset instances, Security Center hardening score + risk acceptance + Identity and Access Management section with granular admin roles, Access Analyzer. Domain separation is a plugin activated with ServiceNow's involvement (cannot be removed once activated). GenAI (Now Assist, AI Agents) is sold in the "Pro Plus / Enterprise Plus"-type SKUs (packaging changes often — unverified). **ServiceNow Otto** (announced 2026-05-05) unifies Now Assist, Moveworks and the AI Experience; Moveworks acquisition closed 2025-12-15 and Veza 2026-03-02. Data Filtration (Yokohama) is marked for future deprecation in favour of Security Data Filters; the Machine Identity Console (Zurich) governs integration accounts. |
| Jira Service Management | Cloud (continuous); Data Center 11.x docs online | 2025 terminology change: projects → **spaces**, issues → **work items** (permissions unchanged). Request-type restrictions (launched July 2024, later extended to customer accounts and organizations). Plans Free / Standard / Premium / Enterprise; Atlassian **Guard** (Standard/Premium) adds SSO, SCIM, authentication policies, data security policies. Rovo (search, chat, agents) is permission-aware; connector permissions kept in sync within a freshness window. |
| Freshservice | SaaS (continuous); plans Starter / Growth / Pro / Enterprise (feature gating of workspaces, custom roles and IP allowlisting by plan — unverified) | Multi-workspace ESM; restricted workspaces and restricted groups (articles updated late 2025 – Aug 2026); approvals with **groups and chains** (May 2026); Freddy AI Copilot licensed per role; Copilot Agent actions configured in **AI Agent Studio** (article updated 2026-11-03). AI Agent Studio was offered as a promotional free service to Growth/Pro/Enterprise until 2026-09-30 (current pricing unverified), is not available in MSP mode, and its conversation logs are not covered by RBAC. |
| BMC Helix ITSM | 26.x (26.1–26.3 doc sets online) | RLS from AR System (field 112 etc.), Company-based multi-tenancy, permission groups + functional roles; **Tenancy Mode** Multi-Tenancy (installed default) or Single-Tenancy (default company); HelixGPT checks the user's ITSM/portal permissions before chunks reach the LLM and keeps tenant data separate in the vector store; 26.3 pins agentic AI to the ticket's customer company even for users who can access several companies. |
| ManageEngine ServiceDesk Plus | Cloud, on-premises and MSP editions (Standard / Professional / Enterprise) | Technician view scopes ("Technicians allowed to view") and sites; MSP "All in associated accounts"; custom-domain access for external users (Aug 2025); Zia Agents built on MCP, each bound to a system-defined, non-editable Zia Agent role. |
| TOPdesk | SaaS (continuous) | Permission groups + filters. |
| HaloITSM | 2026 R2 (v2.236): AI Agents and AI Abilities as runbook steps that authorize as a chosen Halo *Application* | Roles, departments/teams, client and ticket-type restrictions. |
| Ivanti Neurons for ITSM | 2026.1 (Jan 2026; Agentic AI add-on, SaaS only) | Role/object/field/relationship rights, data segregation constraints. |
| GLPI | 11.0.x (11.0 released 2025-10-01; access-control fixes in 11.0.3, 11.0.7 and 11.0.8+); GLPI 12 documentation online (release status unverified) | Entities, recursive profiles, authorization rules, 2FA enforcement per entity/profile. |
| iTop | 3.2 LTS; 3.3.0 | Organization silos, profiles, admin-delegation profiles extension. |
| Znuny | 7.3.x (7.3.1 on 2026-03-25, 7.3.3 on 2026-05-27); 7.2 end of life 2026-03-25; 6.5 LTS | Groups/roles, ACL module deployed to `ZZZACL.pm`. |
| OpenFGA / SpiceDB | OpenFGA is a CNCF incubating project; SpiceDB by AuthZed | Zanzibar-style ReBAC with Check, Expand, ListObjects/LookupResources, ListUsers, conditions/caveats (CEL), consistency tokens. |

## Sources

Official vendor documentation (fetched or read in search results):

- https://www.servicenow.com/docs/r/australia/platform-security/access-control/acl-rule-types.html — ACL types, operations, evaluation order, wildcards (Australia, updated 2026-06-23)
- https://www.servicenow.com/docs/r/oL66E_cwDD_tnWQYzYPRdA/SskxJ_oa8TLXW5vvmUeWNw — Explore Access Control Lists (decision types, applies-to, data condition, pre/post-query, empty ACL deny, security_admin elevation)
- https://www.servicenow.com/docs/r/oL66E_cwDD_tnWQYzYPRdA/FIh1RQ1IWa6Nt5MDmY5hlA — Deny-Unless ACL (Australia, updated 2026-03-12)
- https://www.servicenow.com/docs/r/platform-security/access-control/acl-denial-behavior.html — ACL denial behaviour
- https://www.servicenow.com/docs/r/zurich/platform-security/access-control/query-acl-rule.html — Query ACLs (query_match / query_range)
- https://www.servicenow.com/docs/r/GypxAX2jEErwkCxugICKdg/u5UdzvknUtSGK5YOn3iIqA — Security data filters (Yokohama)
- https://servicenow.github.io/sdk/guides/security-guide — ServiceNow SDK security guide (roles, ACLs, security attributes, data filters, evaluation order)
- https://www.servicenow.com/docs/r/platform-security/access-control/c_DefaultDenyProperty.html — glide.sm.default_mode (Brazil)
- https://www.servicenow.com/docs/r/intelligent-experiences/aia-acl-configuration.html — Deny-by-default ACL configuration for agentic AI
- https://www.servicenow.com/docs/r/intelligent-experiences/enable-ai-experiences/aia-security-implementation.html — Implement access control in Now Assist AI agents (invocation ACLs, run-as, role filtering)
- https://www.servicenow.com/docs/r/zurich/intelligent-experiences/enable-ai-experiences/acls-and-rolemasking.html — ACLs, role masking and user identities in AI Agent Studio (search result)
- https://www.servicenow.com/docs/r/zurich/intelligent-experiences/now-assist-guardian.html — Now Assist Guardian (search result)
- https://www.servicenow.com/docs/r/zurich/platform-security/servicenow-ai-platform-security/c_DomainSeparation.html — Exploring domain separation
- https://www.servicenow.com/docs/r/oL66E_cwDD_tnWQYzYPRdA/SEK7gvUWMv3ud2X6QlefjA — Domain separation terms
- https://www.servicenow.com/docs/r/platform-security/explicit-roles.html — Explicit Roles (search result)
- https://www.servicenow.com/docs/r/zS6yb8e~gR8BPjeviYdV9g/ffhpErJtGvxZsWi4FWrtgg — Managing access to knowledge bases and articles (user criteria)
- https://www.servicenow.com/docs/r/employee-service-management/granular-delegation/granular-delegation-explore.html — Granular delegation
- https://www.servicenow.com/docs/r/H8yQl2SqBqnT6LbpTm28UQ/KyA28LzwUj5~k1Tq5NzJtA — HR profile and HR case security
- https://www.servicenow.com/docs/r/oJu9n0q6rU~F9UHAnNCt5w/0AjGydue_qAjy6Z2SNW2BA — Compare user access / Access Analyzer (search result)
- https://www.servicenow.com/docs/r/oL66E_cwDD_tnWQYzYPRdA/S7VR~Xwf9IzCGoLnTi8X5Q — Instance security best practices (Access Control plugin, High Security plugin, Access Analyzer)
- https://www.servicenow.com/docs/r/delta-xanadu-australia/australia-xanadu-accessmanagement-release-notes.html — Access Management release notes (search result)
- https://www.servicenow.com/community/platform-privacy-security-blog/what-s-new-in-security-center-australia/ba-p/3545239 — Security Center in Australia (search result)
- https://www.servicenow.com/docs/r/brazil/release-notes/available-versions.html — Available versions (Brazil EA 2026-09-24, Patch 2 2026-11-05)
- https://www.servicenow.com/docs/r/washingtondc/customer-service-management/r_RolesInstalledWithCustomerService.html and https://www.servicenow.com/docs/r/customer-service-management/explicit-roles-in-csm.html — CSM roles (search results)
- https://www.servicenow.com/community/developer-forum/number-of-rows-removed-from-this-list-by-security-constraints/td-p/2432941/page/2 — community: before-query rules vs ACL row removal
- https://support.atlassian.com/jira/kb/manage-access-jira-service-management-projects-requests — managing access to JSM spaces and requests
- https://support.atlassian.com/jira-service-management-cloud/docs/add-or-remove-restrictions-on-request-types — request type restrictions
- https://support.atlassian.com/jira-service-management-cloud/docs/customize-jira-service-management-permissions/ — JSM roles, security type, mandatory permissions
- https://support.atlassian.com/jira-cloud-administration/docs/manage-global-permissions/ — Jira global permissions
- https://support.atlassian.com/jira/kb/grant-jsm-administration-access-without-giving-jira-global-admin-rights/ — admin-group pitfall (search result)
- https://support.atlassian.com/organization-administration/docs/how-connector-permissions-are-kept-in-sync/ — Rovo/Teamwork Graph connector permission sync
- https://confluence.atlassian.com/servicemanagementserver/knowledge-base-settings-and-permissions-956713322.html — JSM knowledge base "who can view" (search result)
- https://community.atlassian.com/forums/Jira-articles/Evolving-Jira-terminology-Projects-will-soon-be-Spaces/ba-p/3034977 — projects → spaces (search result)
- https://community.atlassian.com/t5/Jira-Service-Management-articles/Announcing-request-type-restrictions-in-Jira-Service-Management/ba-p/2735416 — request type restrictions launch (search result)
- https://support.freshservice.com/en/support/solutions/articles/50000008929 — roles and permissions in single and multiple workspace setups
- https://support.freshservice.com/support/solutions/articles/50000005579-account-admin-guide-access-controls — agent management and roles
- https://support.freshservice.com/support/solutions/articles/50000005577-understanding-roles-for-agents — built-in roles
- https://support.freshservice.com/support/solutions/articles/50000003479-use-restricted-groups-to-manage-confidential-and-sensitive-data — restricted groups
- https://support.freshservice.com/en/support/solutions/articles/50000006118 — restricted workspaces
- https://support.freshservice.com/support/solutions/articles/156540 — knowledge base folder visibility (search result)
- https://support.freshservice.com/support/solutions/articles/200987 — service catalog visibility by user groups (search result)
- https://support.freshservice.com/en/support/solutions/articles/233754-user-management — departments, heads, prime users (search result)
- https://support.freshservice.com/support/solutions/articles/50000010315 — approvals groups and chains (search result)
- https://support.freshservice.com/support/solutions/articles/50000014452-perform-actions-with-copilot-agent — Copilot Agent actions (updated 2026-11-03)
- https://support.freshservice.com/en/support/solutions/articles/50000009519 — Freddy AI Copilot access by role (search result)
- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM/itsm262/Administering/Access-control-for-ticket-data/Access-control-with-implicit-groups-Row-level-security/ — BMC Helix RLS (mirror of BMC docs)
- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM/itsm252/Planning/How-access-to-tickets-and-resources-works-in-BMC-Helix-ITSM/ — BMC data access models
- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM/itsm262/Planning/Roles-and-permissions/Incident-management-user-roles-and-permissions/ — Incident Master/Config permissions (search result)
- https://www.manageengine.com/products/service-desk-msp/help/adminguide/requests/multi-site-requests.html — ManageEngine multi-site request scoping
- https://pitstop.manageengine.com/portal/en/community/topic/technician-request-permissions — community on combined roles (search result)
- https://page.topdesk.com/en/tutorial-supporting-files-part-2 — TOPdesk permission groups (search result)
- https://github.com/Tools4everBV/HelloID-Conn-Prov-Target-Topdesk-Operators — TOPdesk operator filters as permissions (search result)
- https://usehalo.com/faq-list/haloitsm-trial-guides/page/3/ and https://halopsa.com/guides/article/?kbid=883 — Halo roles, departments, restrictions (search results)
- https://help.ivanti.com/ht/help/en_US/ISM/2017.3/Content/Configure/Security/Authorization.htm — Ivanti Service Manager authorization
- https://help.ivanti.com/ht/help/en_US/ISM/2024/Admin-User/Content/ServiceDesk/Using_Service%20Desk%20Console.htm — role-based workspaces (search result)
- https://help.glpi-project.org/glpi-12/administration/entities — GLPI entities
- https://help.glpi-project.org/glpi-12/administration/profiles/profiles.md — GLPI profiles
- https://awesome.ecosyste.ms/projects/github.com%2Fcombodo%2Fitop-admin-delegation-profiles — iTop admin delegation profiles (search result)
- https://de1.doc.znuny.org/znuny/_sources/admin/acl/index.rst — Znuny ACLs
- https://doc.znuny.org/znuny-7_2-api/_sources/API/Kernel/System/ACL/DB/ACL.rst — Znuny ACL API (search result)
- https://docs.glean.com/connectors/connectors-power-glean — Glean connector permissions
- https://docs.moveworks.com/ai-assistant/enterprise-search/permissions — Moveworks Permissions Platform
- https://help.moveworks.com/docs/file-search-respecting-file-permissions — Moveworks file permissions (search result)
- https://openfga.dev/docs/learn/zanzibar — OpenFGA and Zanzibar
- https://supabase.com/docs/guides/database/postgres/row-level-security — PostgreSQL/Supabase RLS
- https://genai.owasp.org/llm-top-10/ — OWASP Top 10 for LLM Applications 2025

Added in the completion pass (fetched or read in search results, 2026-11-07):

- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM/itsm263/Setting-up-and-going-live/Setting-up-the-Tenancy-mode/ and https://docs.bmc.com/docs/itsm221/setting-up-the-tenancy-mode-1053748069.html — BMC Tenancy Mode (Multi-Tenancy default, Single-Tenancy default company)
- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM/itsm263/Administering/Setting-up-multitenancy-in-BMC-Helix-ITSM/ — BMC multitenancy, MSP example, agentic AI pinned to the ticket's company (26.3)
- https://docs.helixops.ai/bin/Service-Management/Employee-Digital-Workplace/BMC-HelixGPT/helixgpt262/Planning/Security-and-privacy-for-BMC-HelixGPT/ and https://docs.bmc.com/docs/helixgpt/security-and-privacy-for-bmc-helixgpt-1334821292.html — HelixGPT security and privacy (ACL check before context, tenant isolation)
- https://help.servicedeskplus.com/configurations/user-management/configuring-roles.html — ServiceDesk Plus roles, module permissions, FGA, sharing permissions, "Technicians allowed to view", Zia Agent roles
- https://www.manageengine.com/products/service-desk-msp/help/adminguide/configurations/user-management/configuring-roles.html — SDP MSP roles ("All in associated accounts")
- https://github.com/Combodo/iTop/blob/develop/addons/userrights/userrightsprofile.class.inc.php — iTop allowed organizations, select filter, administrator bypass, SharedObject
- https://security-tracker.debian.org/tracker/CVE-2025-64516 and https://www.incibe.es/en/incibe-cert/early-warning/vulnerabilities/cve-2025-64516 — GLPI document access advisory
- https://support.atlassian.com/studio/docs/understand-rovo-agent-accounts/, https://support.atlassian.com/studio/docs/configure-a-rovo-agents-identity/, https://support.atlassian.com/rovo/docs/rovo-agent-permissions-and-governance/ and https://support.atlassian.com/organization-administration/docs/manage-default-access-for-future-agents/ — Rovo agent identities and governance
- https://support.atlassian.com/security-and-access-policies/docs/prevent-atlassian-mcp-server-access/ and https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/ — MCP access control in data security policies
- https://www.servicenow.com/docs/r/zurich/platform-administration/ai-search/content-security-ais.html — AI Search early/late binding
- https://www.servicenow.com/docs/r/zurich/platform-security/data-filtration.html — Data Filtration (deny-based, deprecation notice)
- https://www.servicenow.com/community/platform-privacy-security-blog/introducing-machine-identity-console-new-in-zurich/ba-p/3382508 and https://www.servicenow.com/docs/r/platform-security/authentication/new-inbound-integrations.html — Machine Identity Console and inbound integrations
- https://support.freshservice.com/en/support/solutions/articles/50000012643-introduction-to-ai-agent-studio-in-freshservice and https://support.freshservice.com/en/support/solutions/articles/50000013885-ai-agent-studio-faqs — AI Agent Studio permission, plans, MSP limitation, conversation-log visibility
- https://learn.microsoft.com/en-us/purview/ai-microsoft-purview and https://learn.microsoft.com/en-us/purview/ai-m365-copilot-considerations — Copilot permission trimming and the EXTRACT usage right
- https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/ and https://arxiv.org/abs/2506.08837 — prompt-injection design patterns for agents
- https://docs.powersync.com/sync/streams/parameters, https://docs.powersync.com/usage/sync-streams and https://docs.powersync.com/sync/streams/bucket-count.md — permission-scoped sync buckets, 1,000-bucket default limit
- https://docs.oracle.com/cd/G18294_01/English/Admin/p6_eppm_application_admin/7413.htm and https://docs.oracle.com/cd/F74771_01/English/admin/p6_pro_admin/setting_up_user_security.htm — Primavera P6 security concepts, OBS and resource (RBS) access
- https://knowledge.broadcom.com/external/article/51322/access-to-portlets-and-portlet-pages.html — Clarity PPM OBS association modes

Reference URLs for facts carried over from the first pass (consulted then but not recorded; not re-fetched in the completion pass):

- https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access — emergency (break-glass) access accounts
- https://pages.nist.gov/800-63-4/sp800-63b.html — NIST SP 800-63B-4 authenticator assurance and reauthentication
- https://csrc.nist.gov/projects/role-based-access-control and https://csrc.nist.gov/pubs/sp/800/162/upd2/final — NIST RBAC and ABAC (SP 800-162)
- https://datatracker.ietf.org/doc/html/rfc7643 and https://datatracker.ietf.org/doc/html/rfc7644 — SCIM 2.0 schema and protocol
- https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization — MCP authorization (OAuth 2.1, resource indicators, no token passthrough)
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html — PostgreSQL row security policies
- https://docs.cedarpolicy.com/ — Cedar policy language (permit/forbid, default deny)
- https://electric-sql.com/docs/guides/auth — ElectricSQL shape authorization (proxy and gatekeeper patterns)
- https://authzed.com/docs/authzed/concepts/authzed-materialize — AuthZed Materialize (LookupPermissionSets / WatchPermissionSets)

Sibling research reports in this research set (their own source lists apply) were used for cross-checks: `servicenow.md` (granular roles, enhanced-security plugin, Fluent API), `jsm.md` (units, team-managed spaces, customer access types, data classification, Operations roles), `freshservice.md` (locations, delegation, MSP mode), `others.md` (NetBox, RT, Zammad, Xurrent, MCP servers of TOPdesk/InvGate/Xurrent/Halo) and `ai.md` (Otto, run-as patterns, Simplified ITSM configuration agents, AI governance products).

Secondary sources (used for context, lower weight):

- https://guptadeepak.com/ciam-compass/guides/zanzibar-explained/ and https://authzed.com/learn/openfga-alternatives — Zanzibar concepts, consistency tokens
- https://deviniti.com/blog/enterprise-software/jira-service-management-permissions/ — JSM permissions overview
- https://www.jadeglobal.com/blog/servicenow-domain-separation — domain separation practices

Facts marked "(unverified)" come from general product knowledge and were not confirmed against a 2025–2026 source during this research. This report was completed in two passes (the first was interrupted). The completion pass verified the items listed under "Added in the completion pass" below, and corrected three facts from the first pass: the Freshservice AI Agent Studio promotional period (ends 2026-09-30, not 2026-12-31), the deprecation status of ServiceNow Data Filtration, and the HelixGPT permission behaviour (now verified). HaloITSM permission toggles and TOPdesk filter semantics are still partly from knowledge and marked accordingly.

## Module: access

### Features

- **User records and identity types** — `sys_user` holds company, department, location, cost center, manager, domain, active/locked-out, "web service access only" and "internal integration user" flags; Australia/Brazil add an identity type **AI user** (a dedicated, fixed-role identity that AI agents can run as). [ServiceNow] [AI]
- **Groups, group types and group hierarchy** — `sys_user_group` with manager, parent group, e-mail, cost center and one or more *types* (e.g., itil, approval, catalog) used to filter assignment-group pickers; roles granted to a group flow to every member (child-group inheritance of parent-group roles — unverified); membership in `sys_user_grmember`. [ServiceNow]
- **Roles with containment (role DAG)** — `sys_user_role`; a role "contains" other roles (`sys_user_role_contains`); attributes include *Elevated privilege*, *Assignable by* (the role needed to grant it), *Requires subscription* (licensing) and *Grantable*; scoped roles are prefixed with the application scope (e.g., `x_app.manager`) and role names cannot be renamed after saving. [ServiceNow]
- **Elevated roles (security_admin)** — the High Security plugin creates a distinct `security_admin` role and a default-deny property; even a normal admin must elevate in-session to create or update ACLs and high-security settings. [ServiceNow]
- **Explicit Roles (snc_internal / snc_external)** — every user is stamped internal or external; the two roles are mutually exclusive, cannot contain other roles, and a role containing both cannot be granted; `snc_internal` must never be marked elevated; closes the gap where external portal users could read tables that have no role requirement; adds default KB criteria (Can Read for snc_internal; Can Contribute for snc_internal + another role). Requires Contextual Security. [ServiceNow]
- **Read-only overlay role** — `snc_read_only` makes a user read-only across the instance regardless of other roles (unverified details). [ServiceNow]
- **ACL rule types** — record (table and field), client-callable script include, processor, UI page (read only), REST/execute, plus agentic types added with AI Agent Studio (generative AI skill, flow, flow action, AI agent, agentic workflow). [ServiceNow] [AI]
- **ACL operations** — create, read, write, delete, execute, list_edit, report_on, report_view, personalize_choices, save_as_template, add_to_list (hide/personalize list columns; no conditions/scripts), edit_task_relations, edit_ci_relations, query_match, query_range, conditional_table_query_range, data_fabric. [ServiceNow]
- **Decision types: Allow-If and Deny-Unless** — Deny-Unless ACLs are evaluated first and all applicable ones must pass ("defines the users that will NOT be denied"); passing a Deny-Unless never grants by itself; if no Allow-If ACL matches and the Deny-Unless passes, access is granted by default; Allow-If grants when its requirements pass. [ServiceNow]
- **ACL requirements ("trinity")** — required roles (any one of the list; empty list = true), security attribute, data condition and script (`answer = true/false`); within one ACL every requirement must pass; an ACL must have at least one requirement; empty or invalid ACLs (unknown role/attribute, trivial `answer=true` scripts) deny. [ServiceNow]
- **Applies-to vs data condition** — *Applies-to* decides whether an ACL applies to a record at all (empty = all records; case-sensitive); a *data condition* is evaluated once the ACL applies. [ServiceNow]
- **Table-then-field evaluation and wildcard precedence** — a user must pass a table ACL (table → parent table → `*`) and then a field ACL in the order table.field → parent.field → `*`.field → table.`*` → parent.`*` → `*`.`*`; the first successful field match stops processing; failing every table ACL blocks all fields. Parent-table ACLs apply to extending tables. [ServiceNow]
- **Pre-query vs post-query read checks** — pre-query checks only roles and field permissions; post-query evaluates conditions/scripts per returned row, which is why lists show "Number of rows removed from this list by Security constraints". [ServiceNow]
- **Query ACLs (blind-query protection)** — `query_match` governs "safe" operators (=, !=, IN, NOT IN, SAMEAS, empty/null checks) and `query_range` governs STARTS_WITH, CONTAINS, >=, <=, BETWEEN *and sorting*; failing blocks those operators on that column; default `*.*` delegates to read; Australia auto-loads query ACLs during plugin installation for most platform plugins (EA). Example uses: salary range probing, mapping other people's SSNs. [ServiceNow]
- **Security Attributes** — reusable named predicates (`sys_security_attribute`): compound (encoded query such as `Role=manager^ORRole=admin`) usable in ACLs and data filters; scripted true/false, string, integer and list attributes for other uses; `is_dynamic=false` caches per session; never use `current` (no record context). [ServiceNow]
- **Security Data Filters** — row filters AND-ed into the SQL *before* the query runs (after table-level ACLs, before row ACLs), mode *if* / *unless* a security attribute holds; stop the "rows removed" message and leaks through reports; not checked by `canRead`; applied by default to GlideRecordSecure/sandbox queries, opt-in elsewhere; filters on a child table do not apply when querying the parent table; must be paired with Deny-Unless ACLs; performance-analysis tool warns about unindexed columns and CONTAINS. [ServiceNow]
- **Before-query business rules** — server scripts that add conditions to every query; the out-of-box "incident query" rule limits users without the fulfiller role to incidents where they are caller, opener or on the watch list. Preferred over row ACLs for list performance and UX because the database never returns hidden rows. [ServiceNow]
- **Data Filtration (Yokohama)** — optional, deny-based read restriction stored in `sys_df_data_filtration`: each rule combines *data filters* (field values that make a record available) with *subject criteria* (`sys_df_subject_criteria`, inputs in `sys_df_subject_filter_criteria_m2m` holding groups, roles, an IP range or subnet; comparisons in `sys_df_subject_criteria_condition`); runs after the database query and before ACLs — a record denied here never reaches ACL evaluation; list reports honour it, aggregated reports do not (consistent with `report_view` behaviour); session debugging shows which rules applied; docs advise keeping rules inactive until tested to avoid lock-outs. Distinct from the newer pre-query Security Data Filters. The Yokohama release notice says Data Filtration is being prepared for future deprecation: it is hidden and no longer activated on new instances, and ServiceNow recommends Security Data Filters instead (a vendor moving from post-query to pre-query filtering). [ServiceNow]
- **Contextual Security** — the security manager that evaluates table/field/record ACLs with roles, conditions and scripts (the plugin Explicit Roles depends on); each ACL also has an "Admin overrides" option that lets the admin role pass it (product knowledge). [ServiceNow]
- **Default-deny property** — `glide.sm.default_mode` decides what happens when only wildcard table ACLs match: *Deny Access* restricts CRUD on all tables unless the user is admin or another ACL grants; one-way switch (cannot return to Allow). [ServiceNow]
- **Deny-by-default for agentic ACL types** — on freshly reset Australia/Brazil instances, AI agents, agentic workflows, gen-AI skills, flows and flow actions without explicit ACLs are denied (wildcard ACLs deny only when no primary ACL exists); upgraded instances must opt in. [ServiceNow] [AI]
- **Domain separation: data separation** — every domain-separated table gets a domain field (`sys_domain`); users see records in their domain and its descendants; global is the default domain; data at a higher level is not visible below; tenants see other tenants' data only if granted. [ServiceNow]
- **Domain separation: process and UI separation** — business rules, client scripts, UI policies, UI actions, notifications, views, lists, labels and process definitions can be domain-specific; parent logic runs automatically for child domains and can be overridden at any level (`sys_overrides` marks an override); process visibility flows parent → child only; "Expand/Collapse Domain Scope" shows overrides from global. [ServiceNow]
- **Domain types** — global (system-wide settings, admin accounts), TOP (a process domain at the top), customer domains (data + customer processes), process domains (shared processes, no core data), data domains (data shared across customers without exposing their domains; performance caution), default domain (where new tasks/users go if none is set; otherwise global). [ServiceNow]
- **Contains domains and visibility domains** — *contains* grants a whole domain access to another domain's data; *visibility domains* grant extra domains to a user or group; both "only when absolutely needed". [ServiceNow]
- **Managed domain and domain inheritance from company** — users, groups, departments, locations and CIs inherit their domain from the company record unless a domain admin sets a "managed domain" explicitly. [ServiceNow]
- **Domain picker, domain path, delegated administration** — admins switch the working domain; domain paths encode the hierarchy (avoid in scripts); service providers configure services, end customers get limited delegated administration; activated with the Domain Support – Domain Extensions Installer plugin; can be disabled but never removed; separate instances recommended when complete isolation and no global reporting are needed. [ServiceNow]
- **Organization hierarchies** — company (`core_company`, parent company, customer/vendor/manufacturer flags), business unit, department (`cmn_department`, parent, head, cost center), location (`cmn_location`, parent, type), cost center (`cmn_cost_center`, parent), manager chain (`sys_user.manager`); used by conditions, user criteria, approvals, assignment and reporting. [ServiceNow]
- **User criteria (audience objects)** — reusable records combining users, groups, roles, companies, departments, locations, a "match all" switch and an optional script; bound as Can Read / Cannot Read / Can Contribute / Cannot Contribute on knowledge bases (article level: Can/Cannot Read), and as Available for / Not available for on catalogs, categories, items and Employee Center content; *Cannot* always wins; User Criteria Diagnostics shows effective access. [ServiceNow]
- **Standard delegation** — `sys_user_delegate` (delegate, start/end, approvals, assignments, CC notifications, meeting invitations); flows and workflows honour it. [ServiceNow]
- **Granular delegation** — `sys_granular_delegate` + `sys_delegation_rule` (+ rule tables): approvals and assignments delegated separately with record conditions; notifications (start of delegation, assignment by delegation, all notifications, meeting invitations); *Exclude Delegates* hides confidential notifications; property `glide.approval.delegation.version` v1 (standard only) / v2 (granular only) / v3 (both, default); supports e-signature approvals; **does not grant record access** — delegates still need roles; flows/workflows ignore granular rules. [ServiceNow]
- **Impersonation** — admins (and users with the impersonator role) act as another user without a password; actions are attributed to the impersonated user and the impersonation is logged; HRSD offers a property that blocks HR data while impersonating, even HR-to-HR. [ServiceNow]
- **Access Analyzer and debugging** — Evaluate Access, Compare Access (two users' table-level access showing role / security attribute / condition / script status) and Access Simulator; Debug Security Rules shows ACL evaluation per field; User Criteria Diagnostics for KB/catalog. [ServiceNow]
- **Security Center** — hardening score, version-based hardening and risk acceptance, security scanner, metrics, an Access Controls console / Identity and Access Management section, and granular admin roles so configuration tasks do not need full admin. [ServiceNow]
- **Granular admin and read/write roles (2024–2026)** — monolithic roles are being split so that configuration does not need full `admin`: `sn_incident_admin`, `sn_change_admin`, `sn_mim_admin`, `sn_cmdb_admin`, `sn_on_call_admin`, HAM/SAM admin roles, a tier-1 bundle `sn_service_desk_agent`, and read/write pairs such as `sn_incident_read`/`sn_incident_write`, `sn_problem_read`/`write`, `sn_change_read`/`write`, `sn_request_write` (from the sibling ServiceNow study). [ServiceNow]
- **ITSM enhanced security plugin** — Yokohama added Deny-Unless ACLs for ITSM tables (`com.snc.itsm.enhanced_security`) that block unauthenticated access to incident, change and related tables; auto-activated on Australia/Brazil upgrades. [ServiceNow]
- **Code-first security artefacts** — the ServiceNow SDK's Fluent API declares roles (`Role()` with `containsRoles`) and ACLs (`type`, `table`, `field`, `operation`, `decisionType: allow|deny`, `roles`, `script`, `adminOverrides`) as source code, so access policy can be reviewed and versioned like code; field read-only levels (`read_only_option`: strict_read_only vs client_script_modifiable) arrived in Australia. [ServiceNow]
- **Application-scope protections** — per-table application access (can read/create/update/delete from other scopes, web-service access, "accessible from this scope only"), cross-scope privileges and Restricted Caller Access (e.g., HR tables read from the global-scope workspace require an RCA record). [ServiceNow]
- **Delegated development** — an admin uses *Manage Developers* to give a user or group permissions on one scoped application (they receive the delegated developer role): Delete Application, Source Control, All file types, Playbooks, Integrations, Reporting, Notifications, Decision Tables, Mobile Builders, UI Builder, Workflow, Service Catalog, Service Portal, Workflow Studio, Tables & Forms, **Manage ACLs & Roles**, **Enable Scripting** (write access to script fields; adds the SNC scripting role), Manage/Invite Collaborators and **Delegated Admin** (all of the above); deployment permissions Upgrade App, Publish To Update Set (hidden unless an admin enables it; mutually exclusive with Manage Update Set), Publish To App Store, Publish To App Repo, Manage Update Set, Submit for Deployment. Security-relevant file types and scripting are separate grants, so a delegated developer can build forms without being able to change ACLs. [ServiceNow]
- **Authentication and session stack** — Multi-Provider SSO (SAML 2.0, OIDC), multi-factor authentication, adaptive authentication policies (context such as IP range, roles, groups), IP address access control, session timeout properties, e-signature re-authentication on approvals; SCIM 2.0 provisioning and identity-provider spokes for user/group sync (plugin names unverified). [ServiceNow]
- **Encryption and privacy controls** — Column Level Encryption Enterprise and Data Privacy (clone anonymization) in the ServiceNow Vault family; HR field security for individual form fields. [ServiceNow]
- **Administration tiers** — organization admins (Atlassian Administration), user-access admins, site admins and app admins (Jira "Administer Jira"); a July 2026 KB warns that adding someone to a JSM admin group can silently grant global Jira administration if that group carries the global permission. [JSM]
- **App roles and license types** — app roles granted in Atlassian Administration: **User (agent)** (licensed; with the Service Desk Team space role: portal, queues, reports, SLA metrics, customer-facing and internal comments, add customers; KB and customer/organization management conditional on Administrators), **App admin** (app-wide settings; space settings need App admin + User (agent) + the Administrators space role), **Customer** (portal-only, unlicensed; granted automatically on invite or sign-up; raise and track requests via help center, e-mail or widget, comment, read KB, approve other customers' requests, share if customer permissions allow) and **Stakeholders** (Premium/Enterprise; Customer permissions plus incident updates; on Free/Standard only agents can be stakeholders). [JSM]
- **Collaborators** — licensed users of other Jira apps added to the Service Desk Team role without the agent role: view work items, comments and attachments, add attachments and delete their own, add/delete their own *internal* comments, watch and vote, view watchers/voters, log and manage their own work; "these are the only permissions they can have" (no public replies, no ownership). [JSM]
- **Atlassian Guard** — SAML SSO, SCIM user and group provisioning, authentication policies per user group (SSO enforcement, two-step verification, password policy, session duration/idle timeout), API-token controls, organization audit log, data security policies (e.g., block export/public links; a rule that blocks AI access to content is reported but unverified); Guard Premium adds detections. [JSM]
- **Enterprise units** — Atlassian Cloud Enterprise can split an organization into *units* with their own unit admins, SCIM group allocation and data residency; units form a hard boundary that also confines Rovo (search and agents stay inside the unit); sandbox units give a stronger test boundary. [JSM / Atlassian]
- **Team-managed service spaces** — internal access *Open* (everyone with Jira access gets the default Agent role; only licensed agents talk to customers) or *Private* (only admins and added people); custom roles are composed from permission bundles ("Work on service project requests", "Collaborate on requests", manage watchers, delete own/all comments, attachments and worklogs, administer space). [JSM]
- **Customer access types (site level)** — *internal* (Atlassian accounts on approved domains reach the help center), *external* (portal-only customer accounts, optional allowed e-mail domains), *hybrid*, or *none* (existing customers only); sign-up allowed or not; anonymous portal access (raise without login, account auto-created; not in Government Cloud); IdP-provisioned organization membership for portal-only customers; an org-level setting shares external customers between JSM and CSM. [JSM]
- **Data classification and IP allowlists** — organization-defined classification levels with space defaults and per-request classification by agents; data security policies keyed to levels (block export, public links, anonymous access, app access, AI/MCP access); IP allowlists (Premium) cover the agent and customer portals, the API, Rovo experiences and the Rovo MCP server. [JSM / Atlassian Guard]
- **Operations permissions** — Operations global admins, team roles (team admin, user, custom roles from about 30 permissions on Premium+), "see all alerts" per team. [JSM Operations]
- **Global permissions** — Administer Jira (create spaces, edit work types, fields, workflows and schemes; log in regardless of restrictions; cannot manage users/import/export/e-mail settings), Browse users and groups (all users in pickers and @mentions; otherwise only people with Browse Spaces in the current space), Share dashboards and filters, Manage group filter subscriptions, Manage custom onboarding, Make bulk changes, Create team-managed spaces; Data Center adds a "JSM agent access" global permission. [JSM]
- **Permission schemes** — a reusable scheme of space permissions (Browse spaces, Create / Edit / Assign / Assignable user / Resolve / Close / Transition / Delete / Move / Link / Schedule work items, Set security level, Manage watchers, View voters and watchers, Add / Edit-all / Edit-own / Delete-all / Delete-own comments, Create / Delete-all / Delete-own attachments, Work on work items and worklog rights, Administer spaces, View development tools, View read-only workflow) granted to space roles, groups, single users, reporter, assignee, current user, user/group custom-field values, any logged-in user, public, and security types. [JSM]
- **Space roles for service spaces** — *Administrators* (Administer spaces plus every agent permission; set up request types, queues, SLAs, reports), *Service Desk Team* (agents: Create, Browse, Edit, Schedule, Add comments, Create attachments), *Service Desk Customers* (a role read by the customer security type; permissions are never granted to the role directly). Granting to groups/individuals instead of the roles and security type can disable JSM functions. [JSM]
- **"Service Desk Customer – Portal Access" security type** — customers get Create work items, Browse spaces, Add comments, Create attachments and Assign (needed for the assignee field) through this type; portal access only, never Jira itself. [JSM]
- **Work-item (issue) security schemes** — security levels whose members are roles, groups, users, reporter, assignee, or custom-field values; one level per work item; must include the portal-access security type or customers can create requests they cannot see afterwards; request participants are notified only when the level allows. [JSM]
- **Team-managed space access** — open / limited / private access with simplified roles (applicability to service spaces unverified). [JSM]
- **Who can raise requests** — *open* (anyone; site accounts auto-added as customers) or *restricted* (only invited customers and organizations); site-wide "allow customers to create accounts", e-mail domain restrictions and a separate external customer site. [JSM]
- **Customer organizations** — groups of customers who can see and share each other's requests; used to scope portal access and approver pickers. [JSM]
- **Request sharing settings** — (1) organization only, (2) organization plus anyone entering a full e-mail address (they become customers), (3) any customer or organization in the space. [JSM]
- **Request participants** — can view, comment and share; receive the reporter's notifications; user-picker visibility depends on the sharing setting. [JSM]
- **Approvers** — users or customers named in the approvers field approve from portal or e-mail without an agent licence. [JSM]
- **Request-type restrictions** — limit who can *raise* a request type to ≤50 users, groups, customer accounts or customer organizations; enforced in UI and API but restricted types disappear for everyone from e-mail, chat, widget and the virtual agent; admins and agents are restricted too unless added; automation, change management and app users (Connect/Forge) cannot use them unless the app user or `atlassian-addons-admin` is listed; viewing still needs security levels. [JSM]
- **Internal vs public comments** — agents choose "reply to customer" or "add internal note"; comment visibility can be limited to roles/groups. [JSM]
- **Customer accounts and customer SSO** — portal customers are managed as customer accounts with profiles and organization details, separate from Atlassian accounts; customer sign-in via an external identity provider (details unverified). [JSM]
- **Assets roles** — three scopes: all of Assets (Jira admin), one object schema (Object schema managers / developers / users, plus an *Object viewer* role giving read-only access to all objects of the schema from outside Assets, e.g., Confluence) and one object type (object type manager / developer / user); object-type permissions *override* schema permissions (making a group object-type developers removes create/edit on that type from schema developers outside the group); new schemas automatically put every group that grants JSM access into "Object schema developers" (a permissive default to review); an Assets object field on a portal request type grants any user — even unlicensed customers — a temporary "User" role for the referenced objects (AQL filtering decides which ones appear). Schema roles other than Object viewer need a JSM licence. [JSM]
- **Confluence knowledge-base permissions** — space permissions (view, add pages, comments, attachments, restrictions, export, administer) and page restrictions (view restrictions inherited by child pages; edit restrictions not); JSM "Who can view" per linked space (all users and customers via unlicensed access, customers of the service space, or anonymous when both site and space allow it). [JSM]
- **Agent roles vs admin roles** — agent roles grant privileges on Tickets, Problems, Changes, Releases, Assets, Announcements, Solutions and Reports (and custom modules such as Alerts, Inventory, Contracts, Purchase Orders, Onboarding/Offboarding, Projects, Workload); admin roles grant View/Edit/Delete/Manage per settings module (always service-desk-wide); with several roles the higher access applies. [Freshservice]
- **Scope per privilege** — each agent privilege carries its own scope: across all groups / across the workspace (unassigned + non-restricted groups), in member and observer groups, in specific groups, or assigned items only; privileges that cannot be scoped (e.g., creating announcements) are auto-elevated to workspace scope while still showing only data the agent can see. [Freshservice]
- **Built-in roles** — Account Admin (billing, workspaces; no data unless also an agent role; no access to restricted workspaces), Workspace Admin (implies IT Supervisor), IT Supervisor, Business Supervisor, IT Agent, Business Agent, Problem / Change / Release / Configuration / Contract Manager, IT Ops Agent (alerts), Project Manager / Member, Procurement Manager; custom roles. [Freshservice]
- **Multi-workspace (ESM) permissions** — admin permissions granted account-wide or workspace-wide; agent permissions only inside a workspace; account-wide admins are auto-added to non-restricted workspaces; workspaces "in setup" show published items only to members. [Freshservice]
- **Restricted workspaces** — only explicitly added agents/admins; converting removes account-wide admins (account admins lose access); published content such as service items and solution articles is not hidden by the restriction. [Freshservice]
- **Restricted groups** — tickets assigned to the group are hidden from everyone else, including "across all groups" agents and requesters with department/company-wide view; optional group-leader approval for adding agents, granting leadership, disabling restriction or approval and deleting the group (logged in the audit log; first leader response wins; approval delegation does not apply); identity assumption of restricted-group agents is blocked; deleting the group unassigns its tickets (making them visible again); applies to tickets only, not problems/changes/releases/projects. [Freshservice]
- **Member, observer and leader** — observers can view items owned by the group but not edit; members act per their role scope; every group has at least one leader. [Freshservice]
- **Departments, department heads and prime users** — requesters belong to departments; the head approves department requests; a "prime user"/"can see all tickets from associated departments/companies" permission lets a requester see the department's incidents and requests. [Freshservice]
- **Requester groups** — manual or rule-based groups used for service-item and knowledge-folder visibility. [Freshservice]
- **Locations, delegation and identity assumption** — hierarchical locations (country → city → building/floor) with a primary contact, used in conditions, catalog look-ups and on-call; approval delegation with one active delegate per user, time-boxed and recorded on the approval (API since Jan 2026); *assume identity* for admins (blocked for restricted-group agents); IP range restrictions (Pro+); per-agent API keys act with the agent's role. MSP mode adds *clients* (companies) as a partition with client-specific SLAs, catalog/KB applicability and reports, but there is no true domain separation — hard isolation needs separate accounts. [Freshservice]
- **Agent lifecycle controls** — only account-wide admins add agents; deactivation blocks login, unassigns open/in-progress/pending items, removes the agent from on-call schedules and deletes their private reports; removing an agent from a workspace unassigns open items there. [Freshservice]
- **Agent types and AI licensing** — full-time and occasional agents (all plans), business agents for ESM workspaces (details unverified); Freddy AI Copilot is enabled per role and consumes a Copilot licence per agent. [Freshservice] [AI]
- **Plan gating (pricing page, Nov 2026)** — Starter $19 / Growth $49 / Pro $99 / Enterprise (custom) per agent-month; MSP Mode from Growth; up to 50 support portals on Pro/Enterprise; Audit Logs and Sandbox only on Enterprise; Freddy AI Copilot add-on $29/agent/month on Pro and Enterprise; Freddy AI Agent (Classic) and Freddy AI Insights included in Enterprise. The page does not state the tiers for custom roles, workspaces, restricted groups, SSO, SCIM or IP allowlisting (unverified). [Freshservice]
- **Org structures for people and support** — Company (customer, operating company, vendor, …) > Organization > Department for people; Support Company > Support Organization > Support Group for fulfillers; Region > Site Group > Site for locations. [BMC Helix]
- **Permission groups** — application-level grants such as Incident Master / User / Submitter / Viewer / Config, and equivalents for Problem, Change, Release, Asset, Contract, Service Request and Work Order; Master holders work on any record regardless of support-group affiliation; Config holders reach configuration forms (exact list varies by version). [BMC Helix]
- **Functional roles** — extended rights tied to a support group (Support Group Admin, Support Group Lead, Support Group Manager, Infrastructure Change Manager / Coordinator, Problem Coordinator, Broadcast Submitter, …); template editing limited to members of the template's authoring group. [BMC Helix]
- **Company access and Unrestricted Access** — each person lists the companies they may access; the Unrestricted Access role (and AR administrators) bypass row-level security. [BMC Helix]
- **Tenancy Mode** — the System Settings form has a *Tenancy Mode* field: the product installs as **Multi-Tenancy** (users pick the right company in every Company field) and can be switched to **Single-Tenancy**, where a default company pre-fills the Company field. Tenancy mode changes defaults; data separation itself comes from company access plus row-level security. [BMC Helix]
- **Multitenancy for service providers** — one instance serves several tenant companies whose data is hidden from each other; company-specific support groups see only their company (Calbro Support → Calbro tickets), a global support group with unrestricted access sees all companies; multitenancy governs incidents, problem investigations, change requests, asset records, CIs, known errors, broadcasts, categorization and summary definitions (SRM/Requester console). A CI with a company is visible only to staff with access to that company, and a CI *without* a company only to users with unrestricted access. [BMC Helix]
- **Agentic AI pinned to the ticket's company** — in multitenant environments the customer company on a ticket is the execution context for agentic AI: data is retrieved only for that company (plus globally accessible data), and cross-company data is not exposed even to users who may access several companies (e.g., Ask HelixGPT agent assist answers from the selected ticket's company). [BMC Helix 26.3] [AI]
- **Row-level security via Request ID permissions** — field 1 is visible to the principals stored in Submitter (2), Assignee (4), Assignee Group (112, a semicolon list of user, support-group and company IDs), Assignee Group Parent (60989), Vendor Assignee Group (60900, empty for customer use) and its parent (60901). [BMC Helix]
- **Field-112 composition per form** — incident: customer, contact, assigned support group, owner support group; problem: assigned and coordinator support groups; known error/solution: company; change: requested-for, requested-by, coordinator, manager and implementer groups; release: assigned group; purchase requisition, contract, CI unavailability: company; tasks: the parent ticket's field 112 plus the task's group; work orders and SRM requests: customer/requester plus manager/assignee groups. [BMC Helix]
- **Selectable data access model** — *Support group* (submitter, assignee, owner group, associated child groups and parent groups) or *Support group and company* (adds members of the location and customer companies and their parent groups); applies only to data created after the change. [BMC Helix]
- **Hierarchical support groups** — a parent group sees its own and all child groups' tickets; permissions roll up. [BMC Helix]
- **CI tenancy** — set by the CI's Company field and the "Used by" company relationships. [BMC Helix]
- **AR System field permissions and computed groups** — per-field view/change permissions per group; computed groups combine groups with boolean expressions (applicability in Helix SaaS unverified). [BMC Helix]
- **Technician view scope ("Technicians allowed to view")** — "All" (all configured sites), "All in associated Site" (only the sites linked to the technician on the Technician configuration page), "All in Group & assigned to him [Requests, Problems, and Changes]" and "Assigned to him [Requests, Problems, and Changes]"; it scopes requests, problems, changes and assets, and only for modules where the role grants View; the MSP edition adds "All in associated accounts" (every site under the technician's accounts), and seeing a request of another site also requires association with that site. Community threads report that combining roles yields the broader scope, that selecting an advanced permission can silently enable Edit on all requests, that "group & assigned" technicians get "Request does not fall under your permitted scope" after reassigning a ticket out of their group, and that "created by me" is not a selectable scope. [ManageEngine SDP]
- **Default roles** — SDAdmin (only role with the Admin module), SDSiteAdmin (full access to associated sites and their site-level admin settings), SDGuest (self-service: add requests, view solutions), SDChangeManager (only role that approves/rejects changes), SDCo-ordinator (full Request module), SDMaintenanceManager, SDReleaseManager, SDReport (survey reports; widens report access when combined), ReportConfigAdmin, SDCMDBManager, SDCMDBAdmin, AERemote Control, AnnouncementConfig, Enable CMDB, HelpdeskConfig, ZiaVerifier (verifies Zia predictions) and system-defined Zia Agent roles (Zia Agents are AI assistants built on the Model Context Protocol; each agent has a role defining its permissions, which cannot be edited or deleted); default roles cannot be deleted (SDSiteAdmin can be edited), the roles page notes that SDGuest by default allows viewing all requests regardless of site or department, and requester roles are predefined and cannot be changed. Sharing permissions: "Share requests", "Task technician to access requests", "Technicians in a task group to access requests", "Approve solutions", "Allow technician to view resource management"; requests reached through the task-based options open only from the task details and never appear in the request list. [ManageEngine SDP] [AI]
- **Module permissions and fine-grained authorization (FGA)** — per module View / Add / Edit / Delete (each implies View) / Complete Access; Request FGA: adding/editing request tasks, adding requesters, resolving, disabling stop timer, merging, closing, modifying due time, modifying resolution, re-opening, assigning technicians, editing requester, deleting others' notes, deleting others' time entries, deleting request tasks; Inventory/Purchase/Scan FGA; the Request module permission covers both service requests and incidents; sharing permissions ("Share requests", "Task technician to access requests", "Technicians in a task group to access requests", "Approve solutions"). [ManageEngine SDP]
- **Sites as scoping and configuration units** — each site has operational hours, holidays, SLAs, business rules, groups and technicians; changing a request's site re-applies that site's SLAs and recalculates due-by; technicians can reassign only within associated sites. [ManageEngine SDP]
- **Requester visibility ("Requester allowed to view")** — tickets submitted by the user, by the user's department, or by the user's site (or all); viewing other requesters' details requires the department/site permission; the Approvals tab appears for the initiator and for requesters who can approve; community requests show the gap for directors who manage several departments (only their own department is visible). Reporting manager, department head and site head are used in approval rules (unverified detail). [ManageEngine SDP]
- **Permission groups and operator groups** — permission groups bundle module rights and are linked to individual operators or (preferably) whole operator groups. [TOPdesk]
- **Filters (branch, category, operator)** — linked to operator cards; an operator with *no* filters sees all cards, linking a filter type limits the view to what that filter allows, and every additional linked filter *widens* visibility (filters are grants, not restrictions); exceptions: the "last changer" keeps seeing a card until another operator changes it, and administrators see cards outside filters; options "User can select all Operator Groups" (pick any operator group, not individual operators) and "May escalate to all operator groups" let filtered operators hand work outside their filter; categories outside a category filter cannot be selected (workaround: a shared temporary category); objects use a "hidden operator" (the object's contact) and appear unfiltered only with "Display unassigned cards"; change coordinators count for operator filtering; filter changes apply at the next login; filters also hide records from API users. [TOPdesk]
- **Roles, departments and teams** — agent roles bulk-assign permissions, membership of teams and departments, and notifications shared by agents with the same role; departments give access to all teams under them; settings can be made on the role or on the agent's Permissions tab and the *higher* permission always wins (raising an agent manually is not undone by lowering the role); agents see tickets of the teams they belong to and can assign to any team visible to them; API applications run as a nominated agent who needs team/department access to the tickets plus specific permissions. [HaloITSM]
- **Agent restrictions by ticket type and client** — agents limited to selected ticket types and clients (none selected = all); co-managed setups add client restrictions; per-agent options such as tickets access level and "can view unassigned tickets" appear in Halo setups (exact labels unverified). [HaloITSM]
- **Access Control for configuration objects** — Modify/Owner rights on ticket types, workflows and similar objects (configuration, not ticket visibility). [HaloITSM]
- **Role selected at login** — users with several roles pick one per session; the role governs workspaces/modules (security rights) and business objects/fields (business object rights). [Ivanti]
- **Business-object, field and relationship rights** — View / Add / Edit / Delete per object and per field; child objects must be accessible (not necessarily visible) for "Go To" to work. [Ivanti]
- **Data segregation constraints** — restrict object access via links to the Employee object, linked employee fields, relationships (e.g., Change Approval Board) and hierarchies (organization unit, team/department, geography, cost center); with several teams/hierarchies the most open permission applies (write beats read-only). [Ivanti]
- **Publish permissions** — which roles may share dashboards, quick actions and saved searches with other roles; quick actions on toolbars can bypass form restrictions (a documented caution). [Ivanti]
- **Entity tree** — one instance holds a hierarchy of entities (root → subsidiaries → children); each entity sees its own data plus that of descendants; many entity settings offer "inheritance of the parent entity". [GLPI]
- **Authorizations (user × profile × entity, recursive, dynamic)** — a profile is granted in an entity, optionally *recursive* to child entities ("R") or assigned *dynamically* by rules ("D"); one user can hold different profiles in different entities. [GLPI]
- **Default profiles** — Super-Admin, Admin, Supervisor, Technician, Hotliner, Observer, Self-Service (simplified interface, default for new users) and Read-only. [GLPI]
- **Right types with no deduction** — Read, Update, Create, Delete, Purge, Read notes, Update notes; updating requires read too. [GLPI]
- **Assistance rights and lifecycle matrices** — ticket visibility (own, group, all), be in charge, assign, steal, approve; per-profile allowed status transitions for tickets, problems and changes. [GLPI]
- **Authorization rules** — automatic entity + profile assignment from LDAP attributes, mail domain or inventory tag; inventory updates can replay rules and move assets between entities. [GLPI]
- **2FA enforcement per profile/entity** — "Enforce 2FA" with an issuer suffix. [GLPI]
- **Form access controls (GLPI 11)** — each form has an Access Controls tab: restrict to groups, individual users, profiles or all authenticated users, and optionally "Allow direct access" for public (anonymous) access by link. [GLPI]
- **Lessons from 2025–2026 advisories** — CVE-2025-64516 (CWE-284, CVSS 3.1 base 7.5; before 10.0.21 and 11.0.3 any user could open documents attached to any item — tickets, assets — and anonymously when the public FAQ was enabled; advisory GHSA-487h-7mxm-7r46, public proof-of-concept), CVE-2026-32312 (11.0.0–11.0.6: a user with forms READ could export the structure of forms they were not authorized to see; fixed 11.0.7), CVE-2026-53626 (upgrade to 11.0.8+; document access must check the linked item before serving content) — attachments, exports and secondary endpoints are where access models leak. [GLPI]
- **Organization silos (allowed organizations)** — verified in the current source (`addons/userrights/userrightsprofile.class.inc.php`): `URP_UserOrg` links a user to allowed organizations (with a reason); `GetUserOrgs` expands each allowed organization to all descendants with an OQL `BELOW` join on the hierarchical key; `GetSelectFilter` adds `<owner org attribute> IN (allowed orgs)` to every query on classes that have an owner organization (`org_id` or a `MapContextParam('org_id')` mapping); an empty list means "any org"; administrators bypass the filter entirely; non-administrators cannot see administrator accounts or the Administrator profile; a non-admin editing a user cannot grant organizations outside their own allowed set (`CheckIfOrgIsAllowed`); an optional `SharedObject` mechanism shares objects across silos (read through the select filter; writes on shared classes are decided per object: all objects in the user's orgs = allowed, none = denied, mixed = "depends"); with `security.hide_administrators` enabled, non-administrators do not even see administrator accounts or the Administrator profile. Restricting a user therefore needs at least one allowed-organization entry. [iTop]
- **Profiles: class groups × actions × stimuli** — profiles grant, per *class group* (General, Documentation, Configuration, Incident, Problem, Change, Service, Ticketing, UserRequest, Portal, "*" wildcard…), the actions read, write, delete, bulk read, bulk write, bulk delete and `stimulus:<code>` (lifecycle transitions such as `ev_assign`, `ev_close`, `ev_reopen`); standard ITIL profiles: Administrator, Portal user (redirected to the portal; write own requests, close/reopen), Configuration Manager, Service Desk Agent, Support Agent, Problem Manager, Change Implementor, Change Supervisor, Change Approver, Service Manager, Document author, Portal power user (sees all tickets of the customer organization; used together with Portal user), SuperUser (everything not administrator-restricted), read-only profiles (Configuration ReadOnly, Ticket ReadOnly, Service Catalog ReadOnly) and REST Services User (needed even by administrators to use the REST API). Write permission over a set of objects can be "depends" (some in, some out of the user's silo). [iTop]
- **Groups with permission types and roles** — permission types ro, move_into, create, note, owner, priority, rw per group; queues belong to groups; roles bundle group permissions; customer users and customer companies are mapped to groups for the customer interface. [Znuny]
- **Option-level ACL module** — match on *Properties* (current form values) and/or *PropertiesDatabase* (saved values) with exact, [Not], [RegExp]/[regexp] and negated-regex matching; change with *Possible* (white list), *PossibleNot* (black list) and *PossibleAdd*; restricts queues, states, priorities, types, dynamic-field values and front-end actions; evaluated in order with optional Stop-after-match; saved ACLs take effect only after deployment to `ZZZACL.pm`; not applied to the superuser (UserID 1). [Znuny]
- **Other open-source permission models worth copying** — NetBox object permissions = object types + actions + JSON attribute *constraints* (e.g., `{"tenant__slug": "acme"}`), i.e., ABAC conditions stored as data (Object Ownership added in 4.5); Request Tracker grants rights per role at global, queue, custom-field or catalog level; Zammad grants *full / read / create / change / overview* per group; Xurrent (4me) keeps one *directory account* (people, organizations, sites) shared by several *support-domain accounts* (IT, HR, facilities), so each department has its own configuration on one person base. [NetBox / RT / Zammad / Xurrent]
- **Depth-based access levels** — privileges (Create, Read, Write, Delete, Append, Append To, Assign, Share) × depth (None, User, Business Unit, Parent: Child Business Units, Organization); owner teams and access teams; manager/position hierarchy security; field security profiles; record sharing. [Dynamics 365 / Dataverse — reference model]
- **Org-wide defaults + hierarchy + sharing + restriction rules** — default record access per object, role hierarchy granting managers access to subordinates' records, owner- and criteria-based sharing rules, manual and team sharing, *restriction rules* that narrow access further, permission sets/groups with muting, field-level security. [Salesforce — reference model]
- **OBS-based project security** — Primavera P6 EPPM: every EPS node, project and WBS element has a responsible OBS element; a user gets a *project security profile* per OBS element, so OBS assignment × profile × OBS-on-EPS/WBS decides which projects/WBS (and their activities, risks, issues) the user reaches; assigning the OBS at the EPS root opens the whole EPS, at a branch only that branch; only the global Admin Superuser bypasses. P6 also requires a *global* security profile per user (application-wide data such as resources and the OBS) and has **resource security over the RBS**: "All Resource Access" or up to five resource nodes (the user reaches those nodes and their children); clearing both gives no resource access; Admin Superuser always has all resources. Clarity PPM: rights can be granted to users, groups or OBS units with association modes "Unit only", "Unit and descendants", "Unit and ancestors" and "Unit, descendants and ancestors", chosen per OBS unit when the right is assigned; a resource belongs to one unit per OBS while a user can be a member of many units. [Primavera P6 / Clarity PPM — reference models]
- **NIST RBAC** — core RBAC, hierarchical RBAC, static and dynamic separation of duty constraints. [Framework]
- **ABAC (NIST SP 800-162) / XACML** — decisions from subject, object, action and environment attributes; PEP/PDP/PIP/PAP architecture; combining algorithms such as deny-overrides. [Framework]
- **ReBAC — Zanzibar, OpenFGA, SpiceDB** — relationship tuples (object#relation@user/userset) plus a typed schema; Check, Expand, Read/Write, Watch/ReadChanges, and reverse queries ListObjects/LookupResources and ListUsers; conditions/caveats in CEL; consistency tokens (zookies/ZedTokens) solve the "new enemy" problem; OpenFGA stores tuples in PostgreSQL, MySQL or SQLite. [Framework]
- **Policy engines with partial evaluation** — Cedar (permit/forbid, forbid overrides permit, default deny, schema validation) and OPA/Rego can partially evaluate a policy into a residual condition that becomes a SQL filter (list filtering). [Framework]
- **PostgreSQL row-level security** — per-command policies (USING filters existing rows, WITH CHECK validates new rows), permissive vs restrictive policies, security-definer helper functions to avoid recursive policies, `security_invoker` views; owners and BYPASSRLS roles skip policies unless FORCE ROW LEVEL SECURITY is set. [PostgreSQL / Supabase]
- **Segregation of duties (SoD)** — static (a user may not hold conflicting roles, e.g., security admin and auditor) and dynamic (a user may not perform two conflicting acts on one record, e.g., request and approve the same change). [Framework]
- **Approval authority matrix** — approvers resolved from attributes and thresholds (amount, risk, impact, type, company) and hierarchy level (manager, n-th manager, department head, cost-center owner, CAB), with quorum rules; Freshservice added approval groups and chains in 2026. [Framework / Freshservice]
- **Break-glass accounts** — Microsoft's current guidance (updated 2026-06): at least two cloud-only emergency accounts with no dependency on federation, permanently active (not eligible) top-admin assignment, passwordless phishing-resistant authentication (FIDO2 passkey recommended, or certificate-based) different from normal admin methods, credentials not tied to any individual or personal device and stored in separate fireproof safes, exclusion from blocking Conditional Access policies (tested quarterly), designated secure workstations, alerts on every sign-in, post-mortem review after each use, and validation drills at least every 90 days. [Microsoft Entra — reference]
- **Just-in-time privileged elevation** — time-boxed elevation with a reason, optional approval and step-up MFA (ServiceNow's elevated-role pattern; PIM-style elsewhere). [Framework]
- **Access certification / reviews** — periodic campaigns where managers or owners confirm role, group and entitlement assignments; revocations flow back automatically. [Framework]
- **SCIM 2.0 provisioning** — Users and Groups resources (RFC 7643/7644) with the enterprise extension (employeeNumber, costCenter, organization, division, department, manager); create/update/deactivate (active=false) and group membership PATCH; drives joiner–mover–leaver automation. [Standard]
- **SSO, MFA and session security** — SAML 2.0 and OIDC (authorization code + PKCE), TOTP and WebAuthn passkeys, step-up authentication for sensitive actions, idle and absolute session timeouts, session listing and revocation, IP allowlists, revocation of sessions and tokens on role change or deactivation. NIST SP 800-63B-4 reauthentication: AAL1 overall ≤30 days (inactivity optional); AAL2 overall ≤24 h and inactivity ≤1 h, with at least one phishing-resistant option offered; AAL3 overall ≤12 h and inactivity ≤15 min with a non-exportable-key, phishing-resistant authenticator. [Standard]
- **Atlassian Guard tiers** — Guard Standard ($4.35/user/month list): enforced SSO, SCIM provisioning, API token controls, organization audit log, mobile application management; Guard Premium ($8.55): adds data classification, data security policies by classification level, anomalous-activity and content-scanning detections, alert investigations, SIEM integrations, remediation recommendations (Premium covers Jira and Confluence); Cloud Enterprise includes Guard Standard. [JSM]

### Implementation notes

- **Split capability from scope.** Every grant is *(resource, action, scope, optional condition)*. Freshservice proves that per-privilege scope is understood by admins ("reply: member groups; view: whole workspace"); Dataverse proves the depth ladder (own → unit → unit subtree → organization) maps cleanly to SQL. Keep the enumeration small and closed: `none, own, participant, group, group_subtree, unit, unit_subtree, reportees, location_subtree, company, company_subtree, domain_subtree, all`.
- **Union of grants, intersection of restrictions.** Combine all allow grants with OR (most permissive wins, as Ivanti, Freshservice and multi-role users expect) and then AND every restriction (tenant, domain, security level, restricted group, deny-unless rules). This is ServiceNow's Deny-Unless-then-Allow-If order and Salesforce's restriction-rule semantics, and it never lets a convenience grant punch through a confidentiality rule.
- **Scoped role assignments.** A role is granted *in a context* (tenant, company, domain, org unit, location, group) with a `recursive` flag (GLPI's R flag); the effective scope of each grant is `grant.scope ∩ assignment.context`. This gives "Change manager for the EMEA division subtree" without cloning roles.
- **Denormalised principal keys (BMC field-112 pattern).** Store an `acl_keys text[]` on each secured record, maintained by trigger: typed keys for requester, opener, assignee, participants, assignment group and its ancestors, org unit and ancestors, location and ancestors, company and ancestors, domain and ancestors. A subject's grant then becomes `acl_keys && $subject_keys` (GIN-indexed) plus optional conditions. Subtree scopes become set membership instead of LIKE or recursive queries.
- **Pre-query, never post-query.** Compile the predicate into the SQL `WHERE` (ServiceNow data filters, BMC RLS) so pagination, counts, sorting and aggregates are correct and the UI never shows "rows removed". Use a single repository layer through which every read (lists, record fetch, search, reports, exports, notifications, AI retrieval, sync) passes.
- **One AST, two evaluators.** Compile each grant/restriction into an AST that renders to parameterised SQL *and* to an in-memory JavaScript evaluator. The SQL path filters lists; the JS path checks single rows in write paths, notifications, desktop sync and AI post-filters. A property-based test asserts parity.
- **Inference controls.** Mirror query ACLs: the query builder rejects filter/sort/group-by on fields the subject cannot read and allows only exact-match operators on "match-only" fields (e.g., national ID). Record fetches outside scope return 404 (configurable) so IDs do not act as an existence oracle.
- **Audiences as first-class objects.** Implement user criteria as reusable `audience` rows (users, groups, roles, companies, org units ± subtree, locations ± subtree, requester groups, condition) bound to KBs, articles, catalog items, announcements, portal widgets and AI knowledge sources with allow/deny modes; deny wins.
- **Group membership kinds.** Support member / observer (read-only) / leader, plus restricted groups whose records are invisible to non-members regardless of other grants, with leader approval for membership changes (Freshservice).
- **Domain separation as an optional layer.** Default every tenant to a single domain; when MSP mode is enabled, add the domain predicate and resolve configuration (SLAs, workflows, notifications, forms, catalog, branding) by walking from the record's domain up to global (nearest override wins), copying ServiceNow's process separation and GLPI's "inherit from parent entity".
- **Explainability is part of the model.** Provide `explain(subject, record, action)` that lists every grant and restriction evaluated with pass/fail, a "view as" simulator, a two-user comparison and a "who can see this record" reverse query, as ServiceNow's Access Analyzer does.
- **Cache by epoch.** Resolve the subject context (expanded roles, groups with ancestors, units with ancestors, domains, security levels, delegations, elevations) once per request and cache it under a per-user `authz_epoch` that is bumped whenever a membership, role assignment, tree move or delegation affecting the user changes.
- **Defense in depth for tenant isolation.** Even though the API connects as a server role, enable PostgreSQL RLS with `FORCE ROW LEVEL SECURITY` on tenant tables keyed on a transaction-local setting (`SET LOCAL app.tenant_id = …`), so a query that forgets the application predicate still cannot cross tenants.
- **Say clearly whether a rule widens or narrows.** TOPdesk filters *widen* (no filter = see all, each filter adds), Freshservice restricted groups and JSM security levels *narrow*, JSM Assets object-type roles *replace* schema roles for that type, Halo's role-vs-agent settings take the *higher* value and stay raised. Admins misread all of these. In the product, every rule type is labelled "grant" or "restriction" in the UI, and the policy simulator shows the delta before saving.
- **Handoff grace instead of "last changer" magic.** TOPdesk keeps a card visible to its last changer and ManageEngine users lose a ticket right after reassigning it. Model this explicitly: an optional `recent_handler` participant key with an expiry (e.g., 7 days) added on reassignment, visible in the record's access explanation.
- **Delegated administration is bounded by the delegator.** As in iTop's `CheckIfOrgIsAllowed`, a delegated admin can only grant roles, contexts and organizations within their own administrable set, and can never grant `elevated` or `security_admin`-type roles; enforce at write time and re-check in periodic access reviews.
- **Assignments carry provenance.** Record `source` (manual, SCIM/IdP group, HR-rule, delegation, elevation, migration) and `granted_by` on every role/group assignment so that removing a role from a template, or a user from an IdP group, removes exactly the rights it produced (avoids Halo-style "sticky" manual elevations).

## Module: platform

### Features

- **Secure vs unsecured data APIs** — server scripts using `GlideRecord` bypass ACLs, while `GlideRecordSecure`/sandboxed queries enforce them; Security Data Filters apply by default only to the secure/sandbox APIs and must be enabled explicitly for other user-facing queries (`enableSecurityFeature`). [ServiceNow]
- **List and form behaviour under ACLs** — post-query row ACLs remove rows after the database returns them (the "rows removed by security constraints" message); field ACLs hide or make fields read-only; `list_edit`, `personalize_choices`, `add_to_list`, `save_as_template` operations govern list editing, choice personalisation, column personalisation and templates. [ServiceNow]
- **Admin overrides flag** — each ACL can let the admin role bypass it or not (form field described in product knowledge; not detailed in the fetched page — unverified). [ServiceNow]
- **Audit of security configuration** — ACL, role, group-membership and property changes are recorded in the platform audit/history tables; Security Center tracks hardening drift (exact tables unverified). [ServiceNow]
- **Scoped application isolation** — cross-scope privileges and Restricted Caller Access records control which scope may read/write another scope's tables and call its scripts (e.g., HR tables from the global-scope workspace). [ServiceNow]
- **E-signature for approvals** — approvers re-enter credentials to approve; works with delegated approvals. [ServiceNow]
- **Automation identity** — automation rules run as a configured actor (the "Automation for Jira" app user by default); app users from Connect/Forge apps cannot reach restricted request types unless explicitly added. [JSM]
- **Scheme reuse across spaces** — permission, notification and work-item security schemes are shared objects attached to many spaces, so one change applies everywhere. [JSM]
- **Workflow automator and system context** — workflow automators run with system privileges; deactivating an agent leaves automator references to be cleaned manually. [Freshservice]
- **AR System workflow and permissions** — filters, escalations and active links run in server or client context; field 112 and other dynamic-group fields are maintained by workflow on submit/modify (internal mechanics unverified). [BMC Helix]
- **Form-level restrictions** — business rules combine with field permissions (e.g., status read-only after submission); a view-only pick list stays view-only on forms and can block workflow steps; toolbar quick actions may bypass form restrictions. [Ivanti]
- **ACL deployment step** — ACLs are drafted, then deployed to a generated configuration file read at runtime. [Znuny]
- **Configuration inheritance through a hierarchy** — entity settings (notifications, templates, calendars, auto-assignment, satisfaction surveys, 2FA, UI CSS, helpdesk home tiles) can inherit from the parent entity. [GLPI]

### Implementation notes

- **A single secure data-access layer.** Every query goes through a repository that requires a `Subject` and injects the compiled predicate; an explicit `asSystem(reason)` escape hatch exists for jobs and integrity checks, is lint-flagged in code review and always writes an audit event. Avoid ServiceNow's trap where ordinary server scripts silently bypass ACLs.
- **Automation identity is explicit.** Workflows, SLA timers, notifications and AI background jobs run as a named automation or AI identity with its own permission set (never "god mode"); actions that act *for* a user (e.g., "submit on behalf") record both identities.
- **Config objects get their own ACL.** Separate "configuration" permissions (forms, workflows, SLAs, catalog, notification templates) from data permissions, and allow ownership of individual config objects (Halo's Modify/Owner) so departmental admins can maintain their own catalogs and templates.
- **Policy changes are versioned.** Store permission sets, grants, field rules, audiences and restrictions as versioned rows; show a who-gains/who-loses diff before publishing (simulate on real data) and keep history for audits.

## Module: incident

### Features

- **Default fulfiller vs requester visibility** — users with the fulfiller role read all incidents; the out-of-box "incident query" before-query rule restricts everyone else to incidents where they are caller, opener or on the watch list. [ServiceNow]
- **Watch list and work notes list** — watchers receive notifications and gain visibility as participants; work notes (internal) vs additional comments (customer-visible) have separate field ACLs. [ServiceNow]
- **Domain-aware incidents** — incidents carry the caller's company/domain; agents of a provider domain see child domains; assignment groups and SLAs can be domain-specific. [ServiceNow]
- **Row-level access from ticket relationships** — incident visibility is computed from customer, contact, assigned support group, owner support group and their parent groups (field 112), plus companies when the "support group and company" model is on. [BMC Helix]
- **Agent ticket scope** — tickets visible across the workspace, in member/observer groups, in specific groups, or assigned only; observers see but cannot edit. [Freshservice]
- **Restricted groups for sensitive tickets** — tickets assigned to a restricted group vanish from every non-member, including workspace-wide agents and department-wide requesters. [Freshservice]
- **Work-item security levels** — confidential incidents get a security level; only members of the level (plus portal-access customers if included) see them. [JSM]
- **Request participants and organization sharing** — requester, participants and organization members see the request in the portal according to sharing settings. [JSM]
- **Technician scopes and sites** — technicians see all, associated-site, group-and-assigned or assigned-only requests; request permissions cover incidents and service requests together. [ManageEngine SDP]
- **Ticket visibility rights and "steal"** — see own / group / all tickets; be in charge, assign, steal a ticket; per-profile lifecycle matrix decides allowed status transitions. [GLPI]
- **Queue-based access and option ACLs** — queues belong to groups with ro/rw/move_into/note/owner/priority rights; ACLs restrict selectable states, priorities, queues and actions per ticket context. [Znuny]
- **Organization silos** — agents restricted to allowed organizations see only those organizations' incidents; portal power users see all incidents of their organization. [iTop]
- **Agent restrictions by ticket type and client** — agents limited to certain ticket types/clients; departments widen team visibility. [HaloITSM]
- **Data segregation by employee hierarchy** — incidents restricted to those linked to employees in the analyst's geography/org unit/team. [Ivanti]

### Implementation notes

- **Per-resource security profile.** Declare which fields mean "requester" (requested_for, caller, opened_by), "assignee", "group" (assignment_group, plus owner group for incidents à la BMC), "unit/location/company anchors", "participants" (watch list, request participants) and "confidential markers" (security level, restricted group). The predicate compiler reads this profile.
- **Snapshot anchors at creation.** Copy the requester's company, org unit path and location path onto the incident when it is created (BMC writes company IDs into field 112); later HR moves do not silently re-scope historic tickets, but an admin "re-anchor" job can be run after a reorganisation.
- **Reassignment is a handoff, not a leak.** An agent may move a ticket to a group outside their scope (post-image outside scope) only through the `assign` action; afterwards the agent keeps read access only if another grant covers it (e.g., company-wide read, or "previously assigned" participant keys if the tenant enables it).
- **Internal vs public content.** Model notes as child rows with `visibility = public | internal | restricted(group/role)`; requester-facing APIs and notifications never select internal rows; history entries for masked fields are masked too.
- **Major incidents.** Allow a temporary "broadcast" share (company or domain audience) for status pages and communications without opening the underlying incident record.

## Module: problem

### Features

- **Problem-specific access fields** — problem investigation visibility from assigned and coordinator support groups; known errors and solution-database entries are company-scoped so all members of the company can benefit. [BMC Helix]
- **Problem Manager role** — views and responds to tickets and problems and changes their properties; restricted groups do not apply to problems. [Freshservice]
- **Problem roles** — fulfillers read problems; problem coordinators/managers own the lifecycle (exact role names vary by release — unverified). [ServiceNow]
- **Lifecycle matrix per profile** — allowed problem status transitions per profile. [GLPI]

### Implementation notes

- **Wider read, narrower write.** Problems are usually readable company-wide by all agents (so they can link incidents) but writable only by the problem's group, the problem manager role in context and the coordinator.
- **Known-error publication crosses audiences.** Publishing a known error to the knowledge base creates an article with its own audience; never let the article inherit a broader audience than the problem's confidentiality allows (security-related problems default to internal-only).

## Module: change

### Features

- **Change visibility from requester and implementer relationships** — requested-for, requested-by, coordinator group, manager group and implementer group IDs populate field 112. [BMC Helix]
- **Change functional roles** — Infrastructure Change Manager and Coordinator functional roles per support group; Change Master/User/Viewer/Config permission groups. [BMC Helix]
- **Change Manager / Release Manager roles** — view and respond to tickets and changes/releases and modify their properties. [Freshservice]
- **Approval groups and chains** — approvers can be department heads, reporting managers, agent groups or CAB members, arranged in groups and chains (2026). [Freshservice]
- **Approval delegation and e-signature** — approvals follow standard or granular delegation rules (conditions, separate approvals vs assignments) and can require e-signature. [ServiceNow]
- **Change approver profiles** — Change Implementor, Change Supervisor and Change Approver profiles with lifecycle stimuli rights (approve, implement, close). [iTop]
- **Change validation rights and lifecycle matrix** — rights to request and give validations and allowed change status transitions per profile. [GLPI]
- **Approvers without licences** — any listed approver (including customers) approves from portal or e-mail; change-management apps cannot use restricted request types. [JSM]
- **Template authoring control** — only members of a template's authoring group may modify change templates (Support Group Admin functional role). [BMC Helix]

### Implementation notes

- **Dynamic SoD built into the approval engine.** Reject (or warn, per tenant policy) when the resolved approver is the requester, opener, implementer or assignee of the change; when the only eligible approver is conflicted, escalate to the next level of the authority matrix instead of self-approving.
- **Approval authority matrix as data.** Rows of *(resource, condition such as risk/impact/cost/company/CI class, approver type — manager level n, unit head, role-in-context, group, CAB — quorum any/all/percent/count, e-signature yes/no, escalation)*; evaluated when a change enters an approval state; snapshot the resolved approvers on the change for audit.
- **Freeze and blackout overrides are elevated actions.** Scheduling inside a freeze requires a time-boxed elevated role with a reason, captured in the audit log.
- **CAB visibility.** CAB members get read access to changes on the agenda via a temporary share (participant key) rather than a broad change-read grant.

## Module: release

### Features

- **Release permission groups** — Release Master / User / Viewer / Config; release visibility comes from the assigned support group written into field 112. [BMC Helix]
- **Release Manager role** — views and responds to tickets, changes and releases and modifies their properties. [Freshservice]
- **SDReleaseManager role** — complete access to the Releases module. [ManageEngine SDP]
- **"View development tools" space permission** — controls who sees linked branches, commits, pull requests, builds and deployments on work items. [JSM]
- **Deployment permissions separate from build permissions** — Upgrade App, Publish To App Repo / App Store / Update Set, Manage Update Set and Submit for Deployment are granted separately from development permissions. [ServiceNow]

### Implementation notes

- **Build ≠ approve ≠ deploy.** Three distinct permissions; production deployment requires an approval by someone other than the author (dynamic SoD), configurable per environment and risk.
- **Inherited visibility.** Releases inherit read keys from linked changes and services; deployment records created by pipelines run under a machine identity with a scoped token, and the human trigger is recorded as `on_behalf_of`.
- **Step-up for production.** Approving or executing a production deployment requires recent MFA (AAL2 reauthentication window) and is written to the privileged-action log.

## Module: request

### Features

- **Catalog audiences** — Available for / Not available for user criteria on catalogs, categories and items; "not available" wins. [ServiceNow]
- **Masked variables** — catalog variables of a masked type hide entered values (e.g., passwords) in the UI (storage behaviour unverified). [ServiceNow]
- **Request-type restrictions** — restrict who can raise each request type (users, groups, customer accounts, organizations; ≤50); hidden from search; channel exceptions for e-mail/chat/widget/virtual agent. [JSM]
- **Service-item visibility by agent and requester groups** — per workspace; requester-side limits by requester group instead of all requesters; workspaces in setup show items only to members. [Freshservice]
- **Department-head approvals and visibility** — department heads approve department requests; prime users see department requests. [Freshservice]
- **Request visibility by participants** — requested-for, requested-by and assigned group IDs (SRM requests), customer/contact and manager/assignee groups (work orders). [BMC Helix]
- **Site-specific request rules** — a request follows its site's SLAs, operational hours and business rules; changing the site recalculates due dates. [ManageEngine SDP]
- **Forms with access controls** — GLPI 11 forms can be offered as helpdesk tiles per entity (form-level visibility rules exist; details unverified). [GLPI]

### Implementation notes

- **Check audience twice.** Evaluate catalog/request-type audiences when listing the portal *and* again at submission through every channel (API, e-mail, chat, AI assistant); JSM shows what happens otherwise (channels where restrictions cannot be evaluated drop the restricted type entirely).
- **On-behalf-of rules.** Model "request for others" as a permission with scope (anyone in company, my reportees, my unit subtree, my delegators); the request stores requested_by and requested_for, and both gain participant keys.
- **Sensitive variables.** Variables flagged `sensitive` are encrypted at rest, masked in UI/history/notifications and excluded from AI prompts and search indexes; fulfillers see them only via a field-level grant.
- **Approval visibility.** Approvers get a temporary participant key on the request and its items for the life of the approval (plus a configurable read-only tail).

## Module: knowledge

### Features

- **Knowledge-base and article user criteria** — Can Read / Cannot Read on bases and articles, Can Contribute / Cannot Contribute on bases only; contribute covers create, modify and retire and implies read; a user matching both Can and Cannot is denied; KB-level Can Read with article-level Cannot Read denies the article. [ServiceNow]
- **Role + criteria combination and properties** — by default read requires both roles and user criteria (`glide.knowman.search.apply_role_based_security=false` lets criteria alone decide); `glide.knowman.block_access_with_no_user_criteria` controls whether bases with no criteria are open or closed; `glide.knowman.apply_article_read_criteria` decides whether contributors are still subject to article-level read criteria. [ServiceNow]
- **Special knowledge privileges** — knowledge admin (all non-scoped bases), base owner/manager (contribute, read, edit definition, assign criteria; cannot modify others' drafts when versioning is on), ownership-group members (read, modify, approve, retire the article). [ServiceNow]
- **Explicit-roles default criteria** — Can Read for internal users and Can Contribute for internal users with another role; "Fix unsecured knowledge bases" script for older bases. [ServiceNow]
- **User Criteria Diagnostics** — shows effective read/contribute access to a base or article for a user. [ServiceNow]
- **Folder visibility** — All, Logged-in users, Agents, Departments, Agent groups, Requester groups; drafts always visible on the agent portal; new folders default to everyone; community notes that requester-group visibility can still expose folders to all agents. [Freshservice]
- **Linked Confluence spaces** — "who can view" per space (all users and customers through unlicensed access, customers of the service space, or anonymous when allowed at site and space); space permissions and page restrictions (view restrictions inherit to children) still apply. [JSM]
- **Knowledge targets** — KB items targeted to users, groups, profiles and entities (with recursion) and an FAQ flag for self-service users (from product knowledge; unverified for 12). [GLPI]
- **Company-scoped knowledge** — known errors and solution entries visible to the company's members through field 112. [BMC Helix]
- **Permission mirroring into AI assistants** — Moveworks normalises ServiceNow "available for / not available for" user criteria into ReBAC tuples; Rovo mirrors Confluence and connector permissions. [Moveworks / Atlassian] [AI]

### Implementation notes

- **Audience bindings with deny-wins.** `audience_binding(object, mode, audience)` with modes `can_read, cannot_read, can_contribute, cannot_contribute`; compute `read = (can_read ∪ contributors) − cannot_read` and `contribute = can_contribute − cannot_contribute`; article-level bindings narrow base-level access only (never widen unless the tenant enables "article can extend").
- **Defaults are explicit.** Tenant setting "bases without audiences are: internal-only (default) / everyone / closed" — the ServiceNow properties show how much confusion implicit defaults cause.
- **Chunks inherit the article's audience.** Every RAG chunk row stores the article's audience keys and version; changing an audience re-keys chunks synchronously (or hides the base from AI until re-keying completes — the Rovo freshness-window idea).
- **Drafts are not knowledge.** Drafts, review comments and retired versions are visible only to contributors/approvers and are never used for AI answers to requesters.

## Module: cmdb

### Features

- **CI relationship edit control** — `edit_ci_relations` ACL operation governs who may change CI relationships; table/field ACLs govern CI classes. [ServiceNow]
- **Domain-separated CIs** — CIs inherit domain from their company or a managed domain; provider domains see customer CIs below them. [ServiceNow]
- **CI tenancy by company and "Used by"** — CI visibility follows its Company field plus "Used by" company relationships. [BMC Helix]
- **Configuration Manager role** — accesses the CMDB to manage CIs plus tickets, problems, changes and releases. [Freshservice]
- **Assets object-schema roles** — schema managers/users/viewers and object-type permissions; customers see objects via filtered Assets fields (details unverified). [JSM]
- **Entity-scoped inventory with recursive items** — assets belong to an entity and can be flagged visible in child entities; inventory updates can move items between entities by rule. [GLPI]
- **Organization silos for CIs** — CIs belong to organizations and follow the user's allowed organizations. [iTop]
- **Object rights for CI business objects** — View/Add/Edit/Delete per CI object and field, with data segregation by hierarchy. [Ivanti]

### Implementation notes

- **CI anchors.** Each CI stores company, owning org unit, location path, support group and managed-by group as ACL keys; "support group members may edit CI attributes" is a grant with scope `group` on the support-group key.
- **Graph traversal is filtered per node.** Impact and dependency views apply the read predicate to every node; hidden nodes are rendered as an anonymous "restricted CI" placeholder only when needed to preserve path topology (configurable), never with names or attributes.
- **Impact computed as system, shown as subject.** Service-impact calculation may run with system rights so impacts are correct, but results presented to a user are redacted to visible services/CIs.
- **Discovery credentials and secrets** are a separate resource readable by nobody through the UI; only discovery jobs (system identity) decrypt them.

## Module: itam

### Features

- **Company-scoped asset financial records** — purchase requisitions, contracts and CI unavailability records are visible by company via field 112; Asset/Contract permission groups. [BMC Helix]
- **Contract Manager and Procurement Manager roles** — full contract module access; purchase-order activities. [Freshservice]
- **Assigned-asset visibility for requesters** — requester profiles show assigned assets and software. [Freshservice]
- **Site-scoped assets** — assets and requests follow site associations. [ManageEngine SDP]
- **Financial and management rights** — financial/administrative information rights apply to any object carrying financial data (purging a computer with financial data needs purge on that category). [GLPI]

### Implementation notes

- **Financial fields are field-secured by default.** Cost, purchase price, depreciation, contract value and vendor pricing are masked unless the subject holds a finance field grant, also in exports, reports and AI prompts.
- **Stockroom scope.** Stockroom managers get `location_subtree` scope anchored on the stockroom location; asset moves between stockrooms need write on both source and target.
- **Purchase SoD.** Requester ≠ approver ≠ receiver for purchase orders above a threshold; expressed as dynamic SoD rules.

## Module: slm

### Features

- **Site-scoped SLAs** — every site has its own operational hours, holidays, SLAs and business rules; changing a request's site re-applies that site's SLAs and recomputes due dates. [ManageEngine SDP]
- **Domain-specific SLA definitions** — SLA definitions are process records that can be overridden per domain under domain separation (parent definitions apply to child domains until overridden). [ServiceNow]
- **SLA policies by department or group** — available from the Growth plan. [Freshservice]
- **SLA metrics for agents, configuration for admins** — Service Desk Team members view SLA metrics; space Administrators configure SLAs. [JSM]
- **Selectable data access model affects SLM data** — company-based visibility of service targets follows the support-group/company data access model (unverified detail). [BMC Helix]

### Implementation notes

- **SLA definitions are configuration resolved through the hierarchy** (domain → company → org unit/site); the nearest override wins and the resolved definition ID is stamped on the SLA instance for audit.
- **Timers run as system, records inherit ACL keys.** SLA instances copy the parent ticket's `acl_keys`, so SLA lists and breach reports never show tickets the viewer cannot see.
- **Customer-facing vs internal targets.** Requesters see only customer-facing SLAs; OLAs and underpinning contracts are internal-only fields/records.

## Module: service_portfolio

### Features

- **Service-catalog read-only profile and Service Manager profile** — iTop ships "Service Catalog ReadOnly" (read and bulk read on the Service class group) and "Service Manager". [iTop]
- **Contract-based service entitlement** — customer contracts link organizations to the services they may request; the portal offers only services covered by the user's organization's contracts (product knowledge, unverified for 3.x). [iTop]
- **Service subscriptions** — users, groups, departments or locations subscribed to service offerings drive "my services" views and outage communications (unverified details). [ServiceNow]

### Implementation notes

- **Services as audiences and as anchors.** A service's subscribers/contracted companies form an `audience` reused by catalog items, status pages and AI answers; incidents/changes linked to a service gain an `svc<id>` key so service owners can be granted `service` scope (read all records of their services).
- **Service owner is a role-in-context**, not a global role: `service_owner(service=X)` grants read on linked records and approval authority for changes affecting X.

## Module: event

### Features

- **IT Ops Agent role** — access to the Alerts module and on-call work. [Freshservice]
- **Operations member roles** — operations teams have their own member roles separate from space roles (details unverified). [JSM]
- **Domain-aware operations data** — under domain separation, CIs and tasks generated from events inherit domains so MSP operators see only the customers they serve (unverified for Event Management specifics). [ServiceNow]
- **Agent observability as an event stream** — AI Control Tower's Observe pillar treats AI-agent behaviour as monitored runtime telemetry with alerts. [ServiceNow] [AI]

### Implementation notes

- **Raw payloads are sensitive.** Alert bodies often hold hostnames, IPs, tokens and stack traces; keep the raw payload in a field readable only by operations roles and redact secrets at ingestion.
- **Alert → incident propagation copies anchors.** Incidents created from alerts take company/location/support-group anchors from the CI so the right teams see them.
- **On-call contact data is personal data.** Personal phone numbers on schedules are field-secured (visible to schedulers and the escalation engine, not to all agents); escalation notifications render under each recipient's permissions.

## Module: continuity

### Features

- **Emergency access for identity outages** — at least two cloud-only, federation-independent emergency accounts with FIDO2/certificate authentication, excluded from blocking access policies, quarterly sign-in tests and 90-day drills; contingency access policies to switch on during an outage. [Microsoft Entra — reference]
- **Offline data for continuity** — offline profiles (per-table download filters) let field and desk users keep working during outages. [Dynamics 365 — reference]

### Implementation notes

- **The ITSM tool must work when SSO does not.** Provide a tenant-level break-glass login path that does not depend on the IdP (local FIDO2 credential), sealed and alerting, plus a read-only offline replica of runbooks and KB articles per audience on the desktop app.
- **Degraded-mode policy.** When the IdP is unreachable, existing sessions may be extended (bounded, logged) instead of logging everyone out during a major incident; the policy is explicit and audited.

## Module: security

### Features

- **Security Center and enhanced ITSM security** — the hardening console described in Module: access; Brazil upgrades auto-activate the ITSM enhanced-security plugin (Deny-Unless ACLs blocking unauthenticated access to incident, change and related tables). [ServiceNow]
- **Veza access graph** — after the acquisition closed (2026-03-02), Veza's graph maps effective permissions across human, machine and AI identities and feeds the AI Control Tower Secure pillar. [ServiceNow] [AI]
- **Vault data discovery and classification** — discover and classify sensitive data, protect it by data class, anonymize by data class; Column Level Encryption Enterprise. [ServiceNow]
- **Organization audit log and detections** — Guard Standard includes the organization audit log; Guard Premium adds anomalous-activity and content-scanning detections, alert investigations, SIEM integrations and remediation recommendations. [Atlassian]
- **Audit Logs** — Enterprise plan; restricted-group approvals and changes are logged. [Freshservice]
- **Access certification, SoD, privileged access** — see Module: access (framework bullets) and the recommended model.

### Implementation notes

- **Privileged-action log.** Elevations, impersonation, break-glass use, policy/role changes, bulk exports, mass reads and AI tool calls are written to an append-only, hash-chained log and streamed to SIEM.
- **Read auditing for sensitive classes.** Opening an HR case, security incident or restricted-group ticket writes a read event (who, when, which fields), surfaced to the record owner on request.
- **Access-risk analytics.** Flag users whose effective scope grew sharply, dormant privileged accounts, external users with internal roles, SoD conflicts, and grants not used for 90 days; feed certification campaigns.
- **Security incidents are need-to-know by default.** They live behind a restriction (security level or secure workspace) that even tenant admins do not pass without explicit membership.

## Module: supplier

### Features

- **Vendor assignee groups in row-level security** — Vendor Assignee Group (field 60900) and its parent group (60901) let vendor support groups see tickets assigned to them; the fields stay empty for customer use. [BMC Helix]
- **Vendor companies and contacts** — companies flagged vendor/manufacturer; vendor contacts can be external users with explicit external roles. [ServiceNow]
- **Vendor access through the ticket's principal list** — vendors see only what is written into the vendor fields of a record (BMC field 60900/60901) or what is assigned to their group; contract and procurement managers hold module roles (Freshservice Contract Manager / Procurement Manager, see Module: itam). [BMC Helix / Freshservice]
- **Partner relationships** — partners manage cases and view assets for related customer accounts; new relationships do not expose historic cases. [ServiceNow CSM]

### Implementation notes

- **External agent persona.** Vendor/contractor technicians are `external` users with `assigned` + `vendor_group` scope, no directory browsing, no internal notes except those marked "shared with vendor", and access end dates tied to the contract.
- **Contract fields are financial fields** (value, rates, penalties): masked unless the subject holds the finance field grant.

## Module: financial

### Features

- **Cost center hierarchy** — cost centers with parent cost centers, referenced by users, groups and departments. [ServiceNow]
- **Financial information rights** — a per-profile right governs financial and administrative information on any object; purging objects with financial data needs purge rights on that category. [GLPI]
- **Company-scoped financial records** — purchase requisitions, contracts and CI unavailability visible by company via field 112. [BMC Helix]

### Implementation notes

- **Cost center as an anchor dimension.** Records with cost implications carry `cc<…>` subtree keys so budget owners can be given `cost_center_subtree` scope for chargeback and spend reports without seeing ticket content beyond what their persona allows.
- **Authority matrix thresholds** on cost (purchase, change cost) resolve cost-center owners and finance approvers by amount band.

## Module: project

### Features

- **Project Manager / Project Member roles** — project module roles. [Freshservice]
- **OBS × security profile × EPS/WBS** — project access computed from a user's OBS element and project security profile and the OBS responsible for each EPS node/project/WBS. [Primavera P6 — reference]
- **OBS association modes** — "Unit only", "Unit and descendants", "Unit and ancestors", "Unit, descendants and ancestors" for rights granted through OBS units. [Clarity PPM — reference]
- **Team-managed space access levels** — open / limited / private. [Jira]

### Implementation notes

- **Project membership is a role context** (`project_manager(project=X)`); a portfolio tree (EPS-like) is another anchor dimension with subtree scope.
- **Resource managers vs project managers.** Resource managers (RBS) see assignments and capacity of their people across projects but not all project content; project managers see their project's content but only booking data of external resources.

## Module: workforce

### Features

- **Approval and assignment delegation** — standard delegation (approvals, assignments, notifications, meeting invitations with dates) and granular delegation (separate rules per type with conditions; does not grant record access). [ServiceNow]
- **Occasional agents** — day-pass style agents on all plans; deactivation and group-membership effects are listed under Module: access. [Freshservice]
- **Resource (RBS) security** — schedulers and resource managers reach only the resource nodes assigned to them ("All Resource Access" or up to five RBS nodes and their children), separate from project (OBS) access. [Primavera P6 — reference]
- **Workforce team administration** — JSM Workforce management has a *Workforce team admin* role per team per space, so schedules and forecasts are administered without space-admin rights (from the sibling JSM study). [JSM]

### Implementation notes

- **Joiner–mover–leaver drives authorization.** Joiner: SCIM/HR feed creates the user, unit, manager and default persona; mover: recompute group/unit/role contexts, bump `authz_epoch`, re-key records anchored on the old unit only if the tenant chose live anchors; leaver: deactivate, revoke sessions/tokens, wipe offline replicas, reassign open work, transfer (not delete) owned reports and dashboards.
- **Out-of-office.** Calendar/HR absence creates time-boxed delegations automatically (approvals → delegate, new assignments → group queue) and excludes the agent from routing.

## Module: portal

### Features

- **External users and explicit roles** — portal users (customers, partners, consumers) carry `snc_external`; internal users `snc_internal`; ACLs for unprotected tables require internal. [ServiceNow]
- **Audience-aware portal content** — catalog items, KB articles, Employee Center topics and content follow user criteria. [ServiceNow]
- **Help-center access modes** — open vs restricted service spaces; self sign-up; domain restrictions; separate external customer site; anonymous knowledge access when site and space allow it. [JSM]
- **Request sharing and participants** — organization sharing, participant adding by e-mail, approvers on portal; customers outside an organization cannot share. [JSM]
- **Department-wide requester view** — "can see all tickets from associated departments/companies"; department heads approve. [Freshservice]
- **Portal power user** — sees every ticket of the user's organization in the portal; Portal user sees own tickets. [iTop]
- **Simplified interface per profile** — Self-Service profile uses the simplified helpdesk interface; helpdesk home tiles per entity link to GLPI pages, external pages or forms. [GLPI]
- **Customer interface groups** — customer users and companies mapped to groups decide which queues/tickets appear in the customer interface. [Znuny]
- **Channel exceptions** — request types restricted by audience disappear from e-mail, chat, widget and virtual-agent channels for everyone. [JSM]

### Implementation notes

- **Portal scopes for requesters.** `own` (requested_for/opened_by), `participant` (watcher/shared), `org_shared` (shared with my organization), `unit_subtree_as_head` (department head), `reportees` (line manager chain) and `account_subtree` (customer admin); each is a requester-side grant, not an agent role.
- **Internal directory exposure.** Requesters see a limited directory (display name + e-mail within their own company, or only people involved in their tickets) — the equivalent of Jira's "Browse users and groups" global permission.
- **Anonymous access** is a separate principal (`anon`) with grants only on public KB articles and public catalog items; never on records.

## Module: esm

### Features

- **HR scoped roles** — HR case reader/writer, profile reader/writer, secure-info reader, HR administrator; users without an HR scoped role see no HR cases or profiles. [ServiceNow]
- **System admins kept out of HR data** — after removing the HR Administrator role from IT admins, system admins see only limited HR profile and case data (no comments/work notes, personal information hidden). [ServiceNow]
- **COE security policies** — restrict each HR Center of Excellence's cases to the configured groups (implemented with ACLs); community reports show case readers needed their assignment group in the policy. [ServiceNow]
- **Impersonation blocking for HR** — property makes ACLs check for impersonation so impersonators never see HR information. [ServiceNow]
- **HR field security and restricted caller access** — secure individual fields from specific HR users; cross-scope RCA for workspaces. [ServiceNow]
- **Sensitive topic filters in Virtual Agent** — Now Assist Guardian redirects conversations about sensitive HR topics (e.g., workplace safety, compensation) to a fallback topic; requires HR Service Delivery. [ServiceNow] [AI]
- **Legal delegation controls** — lawyers can limit delegation options when adding delegates in legal service delivery. [ServiceNow]
- **Department workspaces** — HR, Facilities, Finance, Legal workspaces with their own catalogs, KB and automations; restricted workspaces exclude account admins; business agents. [Freshservice]
- **Service desk instances / separate spaces** — separate instances or service spaces per department with their own roles (ManageEngine instance specifics unverified). [ManageEngine SDP / JSM]

### Implementation notes

- **Confidential workspaces are a restriction, not a role.** Implement HR/Legal/Security workspaces as security domains or security levels with explicit membership; tenant admins and platform owners get *no* implicit access; break-glass requires two-person approval and is logged and notified.
- **Field-level masks for HR.** Salary, medical, disciplinary and personal fields are masked by default even within HR, granted per COE.
- **Small-cell suppression.** HR analytics and AI insights suppress groups smaller than a threshold (e.g., k < 10) to prevent re-identification.

## Module: csm

### Features

- **Account hierarchy visibility** — a parent account gives customer admins visibility across child accounts (cases, contacts, assets). [ServiceNow]
- **Customer / customer admin / partner / partner admin roles** — customer admins manage cases and contacts across their account (hierarchy); partner admins manage partner and customer-account cases; partners see their own cases. [ServiceNow]
- **Account and partner relationships** — bi-directional account relationships let partners manage cases and view assets for customers; a new partner relationship does not expose historic cases; contact relationships give contacts access to other accounts. [ServiceNow]
- **Address/location access for external roles** — customer, customer admin, partner and partner admin roles can see account addresses/locations. [ServiceNow]
- **Domain separation for CSM** — MSP-style separation of customers' cases, contacts and processes. [ServiceNow]
- **Customer organizations and customer accounts** — organizations as companies; members share requests; customer accounts separate from Atlassian accounts. [JSM]
- **Company-based multi-tenancy** — support group and company data model; unrestricted access role. [BMC Helix]
- **Account-scoped technicians** — "All in associated accounts" for MSP technicians. [ManageEngine SDP MSP]
- **Client restrictions for agents** — agents limited to clients; customers organised by client > site. [HaloITSM]

### Implementation notes

- **Account subtree + relationship tuples.** Store account hierarchy as a tree (company with parent) and partner/contact relationships as tuples `(account, relation, principal)`; the customer-admin scope is `company_subtree` on the case's account key, partner scope is `rel:partner_of`, and historic-case cutoff is a condition `case.created_at >= relationship.starts_at`.
- **External users never inherit internal grants.** Enforce an `external` flag on users and roles (explicit roles): roles marked internal-only cannot be granted to external users, and every grant on internal resources implicitly ANDs `subject.internal`.

## Module: analytics

### Features

- **Report operations** — `report_on` and `report_view` ACL operations; reports run under the viewer's ACLs and data filters; Security Data Filters also stop sensitive data leaking through reports. [ServiceNow]
- **Query ACLs against inference** — range queries and sorting blocked on sensitive columns where the user may only match exact values. [ServiceNow]
- **Dashboard and filter sharing** — sharing dashboards and filters requires the global "Share dashboards and filters" permission; JQL results respect Browse permission and security levels. [JSM]
- **Report permission elevation that still respects data scope** — "Manage ticket reports" with assigned-items scope is elevated to workspace scope but shows only tickets the agent can see; private reports of deactivated agents are deleted. [Freshservice]
- **Publish permissions for dashboards and saved searches** — which roles can share analytics artefacts with other roles. [Ivanti]
- **Statistics rights** — statistics visibility per profile under Assistance rights. [GLPI]

### Implementation notes

- **Run as viewer by default.** Every report, dashboard widget, KPI and AI-generated chart compiles to the same query builder with the viewer's predicate and field masks; sharing a dashboard shares the *definition*, not the data.
- **Explicit snapshots.** For executive packs, an author with a `publish_snapshot` right can publish a frozen, aggregated snapshot computed under their scope; the snapshot is labelled with author, scope and time and is read-only.
- **Aggregate privacy.** Suppress or bucket cells below a configurable k, forbid grouping by masked fields, and block "difference attacks" by refusing near-duplicate queries that differ by a single record (rate limit + minimum group size).

## Module: ai

### Features

- **Three-layer access control for AI agents** — ServiceNow separates *who can invoke* (ACLs), *which identity the agent acts as* (run-as user identity) and *what it can do* (role filtering). Invocation ACLs in AI Agent Studio are role-based Allow-If rules with three options: "Any authenticated user", "Users with specified roles" (default) and "Public" (includes signed-out guests); Deny-Unless rules can be added only in the ACL table (`sys_security_acl`). ACLs are required for agentic workflows, AI agents, external AI agents, generative AI skills, flows and flow actions; Studio ACLs govern invocation only. [ServiceNow] [AI]
- **Downstream ACL conjunction** — the invoking user (or the AI user) must satisfy the ACLs of *every* component assigned to an agent, even components not used in a given run; conflicting requirements make execution fail (fail-closed composition). [ServiceNow] [AI]
- **Run-as identity: Dynamic user vs AI user** — *Dynamic user* (default) runs as the invoking user, or as the triggering resource or parent agent, so the agent's rights change with the caller; *AI user* is a fixed `sys_user` record whose identity type is "AI user" with preconfigured roles, used for consistent (possibly elevated) privileges in autonomous runs. [ServiceNow] [AI]
- **Role filtering (role masking)** — restricts the roles a dynamic-user caller lends to the agent to a builder-approved subset (least privilege: effective rights = caller's roles ∩ allowed roles); does not apply to AI users. [ServiceNow] [AI]
- **Deny-by-default for agentic resources** — newly activated instances (Australia onward) deny AI agents and agentic workflows that have no explicit ACL: the wildcard ACL carries Security Attribute "Never" with Decision Type "Allow If", so it denies only when no primary ACL exists; upgraded instances must opt in; AI Agent Studio home and guided setup show warning banners for agents/workflows without ACLs. [ServiceNow] [AI]
- **Now Assist Guardian** — three guardrails: *offensiveness detection* (toxic, defamatory or fraudulent output; only supported Now Assist skills/workflows; log or block), *prompt-injection detection* (all generative AI features on the instance; model trained on role-play, paraphrasing and "ignore previous instructions" techniques; documented as not catching every attempt), *sensitive-topic filters* (Virtual Agent only, requires HR Service Delivery; redirects to a fallback topic instead of an AI answer). Docs recommend running in log mode before blocking; community notes severity levels Low/Medium/High (unverified). [ServiceNow] [AI]
- **Data Privacy for Now Assist** — a masking layer in the Generative AI Controller: regex/data-pattern rules replace sensitive values with placeholders or anonymized values before inference and restore originals in the response (two-way masking), for Now LLM Service and third-party/BYO models; requires the Data Privacy and Data Discovery apps; masked prompts are verifiable in the generative-AI log table (`sys_generative_ai_log`, per community); does not clean data already stored and can reduce answer quality; Sensitive Data Handler covers Virtual Agent and Agent Chat. [ServiceNow] [AI]
- **AI Search content security: early vs late binding** — *early binding* (default) compiles the user's security filters into the search query (non-scripted ACLs, before-query business rules, domain separation, user criteria on `kb_knowledge` and `sc_cat_item`); *late binding* post-filters each hit with `GlideRecord.canRead()` and supports scripted ACLs; AI Search falls back to late binding when hits involve table-level scripted ACLs or an early-binding filter errors; late binding can be forced per indexed source ("Force Late Binding") or globally (`glide.ais.security.force_late_binding`). Side effects: displayed results can be fewer than the count, and facet values shrink to the current page. Scripted and conditional field-level ACLs are not supported. Release notes differ on the trigger (one says scripted ACLs or errors cause the fallback, the Australia page lists scripted table-level ACLs among the indexed security features), so check per release. [ServiceNow] [AI]
- **External content permissions in AI Search** — permissions on external documents are preserved at ingestion; admins alias ServiceNow users to the external users/groups in those permissions and AI Search builds security filters from permissions + aliases (requires the External Content for AI Search plugin). [ServiceNow] [AI]
- **Permission-aware Q&A ("Genius results")** — Now Assist in AI Search generates a Q&A answer card only when a highly relevant article *that the user can access* exists; otherwise users see an ordinary result list or "no content" (content security). [ServiceNow] [AI]
- **AI Control Tower** — introduced at Knowledge 2025 and expanded at Knowledge 2026 (2026-05-05) into five pillars: *Discover* (AI assets across ServiceNow, AWS, Google Cloud, Azure, SAP, Oracle, Workday; non-human identities, OT/IoT), *Observe* (runtime agent observability via the acquired Traceloop), *Govern* (risk assessment for agents, models, datasets, prompts and classic ML; five risk frameworks aligned to NIST and the EU AI Act), *Secure* (Veza access graph — Veza acquisition completed 2026-03-02 — scoped permissions and least-privilege enforcement for every AI system/agent/identity; detects agents operating beyond their permissions and shuts them down in real time, i.e., a kill switch), *Measure* (cost and ROI). An **AI Gateway** applies real-time controls to customers' MCP transactions; MCP servers are tracked as governed assets (June 2026 release). Enhancements entered Innovation Lab in May 2026 with GA expected August 2026. [ServiceNow] [AI]
- **AI identities as first-class principals** — `sys_user` identity type "AI user" (ServiceNow), Rovo "Agent's account" (Atlassian), system-defined "Zia Agent roles" that cannot be edited or deleted (ManageEngine ServiceDesk Plus), and a dedicated "ZiaVerifier" role that verifies Zia predictions. [ServiceNow / Atlassian / ManageEngine] [AI]
- **Rovo acts as the user** — a Rovo agent acts on behalf of the user interacting with it and can only access or act on spaces, pages, work items and other information that user can access (e.g., cannot answer about a page the user cannot view, cannot delete a page the user cannot delete); admins can narrow further via agent instructions and configured tools. [Atlassian] [AI]
- **Rovo agent identity: "User's account" vs "Agent's account"** — with the user's account the agent inherits everything that user can do (even if configured with specific tools) and actions are attributed to the user (in automations: to the automation creator, including their access to restricted spaces); with the agent's account it reaches only what was granted through three layers — *Organization access* (org-admin defaults in Atlassian Administration), *App access* (app/space admins grant or deny spaces) and *User access* (any user can grant the agent access to their own content) — and actions are credited to the agent in audit logs; Atlassian recommends the agent's account for most automations. Org admins set *default access for future agents* (apps and groups), and new agent accounts are automatically given the user role of those apps; switching an agent from the user's account to the agent's account requires those defaults to exist. [Atlassian] [AI]
- **Rovo agent governance** — Rovo Studio admin role; agent-creation setting "All users" (default) / "Selected groups" (up to 10 groups) / "No users"; per-agent sharing via "Open to all users" (default on) or explicit users who must be Editors or Managers (restriction by group or team not supported); restricted agents disappear from the directory and from automation pickers; available on Standard, Premium and Enterprise, not Atlassian Government Cloud. [Atlassian] [AI]
- **Teamwork Graph connector permission sync** — Rovo indexes third-party sources through connectors that keep source permissions in sync within a "freshness window"; content whose permissions are stale is handled conservatively (details per connector). [Atlassian] [AI]
- **AI-channel blocking via data security policies** — the "Atlassian MCP server" control in a data security policy allows or blocks AI agents and assistants reading Jira/Confluence content through the Atlassian MCP server, for the whole org, specific sites, or individual spaces/projects (Guard Premium adds classification-level scoping); the block applies even when the user could view the item directly — a blocked work item is treated as nonexistent and the agent receives "does not exist or you don't have permission", so agents may return incomplete results; it can be set at organization, site, content-object or classification level (Guard Standard; classification overrides need Guard Premium); enforced only for OAuth (not API tokens) and not for custom MCP servers. "Rovo Chat security" (block/redact sensitive data in prompts and responses) was announced as coming soon at Team '26. [Atlassian] [AI]
- **Channel-aware request-type restrictions** — request types restricted to an audience cannot be evaluated in e-mail, chat, widget and virtual-agent channels and therefore disappear from those channels for everyone. [JSM] [AI]
- **Freddy AI Copilot licensed and enabled per role** — admins choose which Copilot capabilities (and Freddy Insights) each agent role gets; a Copilot licence is assigned per agent. [Freshservice] [AI]
- **Copilot Agent actions with permission checks and action policies** — Copilot Agent checks the agent's permissions before *recommending* an action and performs it only if the agent holds the required permission; per action: "Always allowed", "Approval required" or "Blocked" (configuring single actions turns the app setting into "Custom"); actions are available only to the app's "Default groups" or per-action groups ("Custom (0)" blocks everyone); new app actions arrive "new and unmapped" in a safe state; agents approve or ignore recommended-action cards and some actions always require extra confirmation. [Freshservice] [AI]
- **AI Agent Studio RBAC** — building/managing AI agents requires the *Manage AI Agent Studio* permission on a role ("localized RBAC" instead of account-admin only); launched 2026-05-14 for Growth, Pro and Enterprise as a promotional free service until 2026-09-30 (current pricing unverified); not available in MSP mode; agents act through Freshservice workflows and ~30 out-of-the-box integrations. Gap: anyone with this permission can read the AI agent conversation logs of the *whole workspace* in the Analyse module, and RBAC is not supported for conversation logs — Freshservice itself advises granting it only to people who may see all AI conversations. [Freshservice] [AI]
- **Freddy AI Agent (requester-facing)** — Slack, Microsoft Teams (ServiceBot), Email Bot and Support Portal channels; enterprise search across the knowledge base, SharePoint, Google Drive and Confluence with cited sources; Enterprise plan with 1,200 sessions per licence per year (session = unique user within 24 h); how connected-source permissions are applied is not documented (unverified). [Freshservice] [AI]
- **HelixGPT permission enforcement** — uses the end user's existing BMC Helix ITSM / Helix Portal permissions; an ACL check runs before contextual data is returned, so chunks of documents the user cannot view are never sent to the third-party LLM (example: an IT support agent cannot retrieve HR support tickets); chunks store document ID and metadata with content and embedding, on AES-256 encrypted disks; the 1-series docs describe tenant isolation by separate indexes, 26.2 says tenant data is "logically separate"; permission changes are "immediately synced"; vector DB (OpenSearch, shared service) isolates tenants by index with tenant-specific RBAC and forbids cross-tenant search; dynamic tags filter knowledge by role, permission and location; HelixGPT Admin role for prompts and HelixGPT Agent Studio role for skills/agents; no built-in PII masking (customer must remove PII from sources); Azure AI Content Safety Prompt Shields recommended against injection; LLMs Azure OpenAI and Vertex AI, BYOK/HYOK planned; in multitenant environments agentic AI is pinned to the ticket's customer company (see Module: access). [BMC Helix] [AI]
- **Mirrored vs managed permissions** — Moveworks (acquisition by ServiceNow completed 2025-12-15) offers *Mirrored Permissions* (ReBAC: source READ/WRITE grants and group/role memberships are fetched and flattened into direct content→operation→user tuples stored in OpenFGA; ServiceNow user criteria are mirrored and stored in Redis), *Managed Permissions* (ABAC DSL over user attributes such as division, department, country and content attributes such as KB/space/site/URL), "Public to all members" (TRUE), "Denied for all members" (FALSE) and *User Consent Permissions* for Live Search (per-user OAuth token, source API queried at question time). [Moveworks] [AI]
- **Pre-filter + post-filter retrieval** — Moveworks applies ReBAC tuples at retrieval (index-time pre-filtering of documents and embeddings) and ABAC rules as query-time post-filtering; permissions are refreshed via events/webhooks or time-boxed (~15 min) change checks over content, permission, group/role and user records. [Moveworks] [AI]
- **Permission-filtered context pool** — Glean connectors fetch the source's permission map plus people/group data, align identities across apps, filter search and chat retrieval by synced permissions, merge indexed and live (request-time, per-user) retrieval into one permission-filtered context pool, and rely on the source to enforce again at click time; agents read "within permissions" and admins decide which tools run automatically versus with human-in-the-loop approval. [Glean] [AI]
- **Restricted Content Discovery** — excludes selected SharePoint sites from Microsoft 365 Copilot and organization-wide search while leaving users' access unchanged; a July 2026 change (MC1427972) also stops recently accessed files from protected sites leaking back through MRU-style discovery; legacy Restricted SharePoint Search blocks new enablement from 2026-07-31. Pattern: an *AI-channel restriction* that is stricter than record permissions. [Microsoft 365 — reference] [AI]
- **Trust layer pattern** — Salesforce's Einstein Trust Layer chains secure data retrieval under the user's permissions, dynamic grounding, sensitive-data masking, zero data retention at the LLM provider, toxicity scoring and an audit trail (Trailhead notes masking is disabled for agents — unverified). [Salesforce — reference] [AI]
- **OWASP Top 10 for LLM Applications 2025** — LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency (excess functionality, permissions or autonomy), LLM07 System Prompt Leakage, LLM08 Vector and Embedding Weaknesses (unauthorized access and cross-tenant leakage in RAG stores; recommends permission-aware vector stores and logical partitioning) — the checklist an ITSM AI layer is audited against. [Framework] [AI]
- **Permission trimming and usage rights in Microsoft 365 Copilot** — Copilot only uses organizational content the signed-in user can at least view (Graph returns nothing otherwise); for content encrypted by a sensitivity label (or Azure RMS) the user also needs the **EXTRACT** usage right ("Copy and extract content"); with VIEW but not EXTRACT, Copilot does not summarize the content and only references it with a link. Pattern: a second, AI-specific right ("may this content be extracted into an answer?") on top of read. [Microsoft 365 — reference] [AI]
- **Prompt-injection design patterns** — "Design Patterns for Securing LLM Agents against Prompt Injections" (arXiv 2506.08837, June 2025; authors from Google, Microsoft, IBM, ETH Zurich, EPFL) proposes six constraints: *action-selector* (the model only picks from a fixed action set and never sees tool output), *plan-then-execute* (tool sequence fixed before untrusted data is read), *LLM map-reduce* (untrusted documents processed by isolated sub-agents), *dual LLM* (a privileged model handles tools; a quarantined model reads untrusted data, whose results are passed by reference), *code-then-execute* (as in DeepMind's CaMeL) and *context-minimization* (drop the user prompt or untrusted text from context once it has served its purpose). Commentators note the patterns constrain *which* actions run, not their arguments. [Framework] [AI]
- **MCP servers scoped to the caller** — ITSM vendors expose MCP servers that inherit the calling user's permissions or are read-only: TOPdesk (read-only, customer's own data), InvGate (nine read-only tools; per-user, revocable tokens that inherit the user's permissions; ready configs for Claude Desktop/CLI, Cursor, VS Code, Gemini CLI, Codex CLI), Xurrent (external agents inherit the "Shared Policy and Data Layer" with the same audit as native agents), Halo (AI Agent steps authorize as a chosen Halo *Application* identity and use the same functions as Halo's MCP server), ManageEngine (Zia Agents with system-defined roles). [TOPdesk / InvGate / Xurrent / Halo / ManageEngine] [AI]
- **AI provenance and governance switches** — Halo flags AI-created tickets, actions and KB articles with the creating Virtual Agent, AI Agent or MCP Tool Collection; SysAid gates all Copilot configuration behind an "AI Admin" permission; Alemba lets admins switch each AI capability on/off and logs every AI action; TOPdesk keeps all AI features off by default and labels AI output ("TOPdesk suggests, your operator decides"); InvGate's AI "operates within existing permissions" and never sends responses automatically, with per-action autonomy (auto / confirm / never). [Halo / SysAid / Alemba / TOPdesk / InvGate] [AI]
- **Agents run as the accountable human** — ServiceNow's "Investigate and resolve" agent trigger must use *Run as: Assigned to*; Atlassian Ops Expert resolves linked resources with the viewing user's permissions (results differ per viewer); Request Resolver shows help seekers only what they may see or what an agent approved, and runs in *Supervised* mode before a request type is promoted to *Autonomous*. [ServiceNow / Atlassian] [AI]
- **AI that configures access** — ServiceNow "Simplified ITSM" ships configuration agents for SSO, groups and roles, data imports, routing rules, SLAs and change models; Moveworks offers a Data Ingestion View and Permissions Checker so admins can see which content a given user can reach. [ServiceNow / Moveworks] [AI]
- **Delegated authorization for AI tools (MCP)** — the Model Context Protocol authorization spec (2025 revisions) builds on OAuth 2.1: MCP servers act as OAuth resource servers, tokens must be audience-bound (resource indicators, RFC 8707) and must not be passed through to downstream APIs (prevents confused-deputy attacks); exact revision details unverified. [Standard] [AI]

### Implementation notes

- **Effective AI permission = user ∩ agent ∩ channel.** For an assistant acting for a person: `allowed(action, record) = user_can(action, record) AND agent_tool_allows(action) AND ai_channel_allows(record)`. The agent never adds rights (ServiceNow role filtering, Rovo "acts on behalf of the user"); an AI-channel restriction can only remove rights (Atlassian MCP control, Microsoft RCD). Autonomous agents get their own identity (AI user / agent account) with an explicit, minimal permission set; their actions are attributed to the agent and to the human who triggered or approved them.
- **Retrieval joins back through the same predicate.** Store chunks in Postgres (pgvector) next to their record: `chunk(id, tenant_id, record_type, record_id, field, acl_keys text[], visibility, classification, version, embedding)`. The retrieval SQL is `ORDER BY embedding <=> $q` *with* the subject's compiled read predicate in the `WHERE` (early binding: `acl_keys && $subject_keys AND tenant_id = $t AND NOT restricted...`), then a second, exact check of the top N through the record-level evaluator (late binding) before anything reaches the prompt. Over-fetch (e.g., 3× N) to keep recall after late filtering, and never show the pre-filter count.
- **Field security reaches chunks.** Chunks are built per field group; fields the subject cannot read (internal work notes, HR fields, financial fields, masked variables) produce chunks with stricter keys or are never embedded. Requester-facing assistants never retrieve internal notes, even when the requester is also an agent elsewhere (persona-scoped retrieval).
- **Index freshness is a security property.** Re-key chunks synchronously in the same transaction that changes a record's ACL anchors (assignment group, security level, company, restricted flag), or mark them `stale` so they are excluded until re-keyed; a nightly reconciliation compares chunk keys with record keys. Moveworks' 15-minute and Rovo's freshness-window designs show what happens otherwise: a short window where revoked users still get answers.
- **Tools run as the user.** Every tool the model can call is an ordinary API operation executed with the user's session/token and the same authorization layer as the UI; there is no "AI service account" path for user-initiated assistance. Tools declare `required_permission`, `risk` (read / write / destructive / external) and `policy` (auto / confirm / approval / blocked), mirroring Freshservice's action policies; unmapped new tools default to blocked.
- **Writes are proposals.** The model emits a structured *change proposal* (target record, field diff or action, justification, sources). The UI renders it for confirmation; confirmation executes through the normal mutation path (validation, business rules, SoD, audit). High-risk proposals (closing a P1, approving a change, granting a role, mass updates, external messages) require explicit approval, possibly by someone other than the requester; the proposal and its outcome are kept for audit and evaluation.
- **Citations are re-authorized at render time.** Each citation is a record ID that is re-checked with the current subject before display; failing citations are dropped silently (no "3 hidden sources" hints). Answers cached for reuse are keyed by `(tenant, subject authz_epoch, normalized query, source versions)`; a semantic cache is never shared across subjects unless every source is public.
- **Prompt-injection containment.** Retrieved records, e-mails, attachments and tool outputs are *data*: wrap them in delimited, labelled blocks; never let them change the tool allowlist, the identity or the policy; strip/neutralise active content (markdown images, auto-links) to block exfiltration; restrict outbound HTTP tools to allowlisted hosts; for high-risk flows use a quarantined-reader pattern (a model without tools summarises untrusted text, a tool-using model sees only the summary); run an injection classifier (Guardian/Prompt Shields-style) in log mode first, then block.
- **Sensitive-data minimisation.** Mask PII and secrets before sending prompts to external models (two-way placeholder masking à la Data Privacy for Now Assist), keep a per-tenant "allowed model providers/regions" policy, and send only the prompt plus the authorised context needed for the task.
- **Aggregations and insights.** AI-generated charts, trends and "insights" compile to the same report engine under the viewer's predicate; small-cell suppression applies (HR, security); the model receives aggregates, not raw rows, when the question is statistical.
- **Kill switch and observability.** Per-tenant and per-agent switches (disable agent, revoke tool, revoke AI identity tokens), rate limits per subject, anomaly alerts when an agent touches more records than usual or hits repeated authorization denials (the AI Control Tower "agent beyond its permissions" pattern), and a full trace: prompt, retrieved IDs, tool calls with arguments and results, approvals, model and version, token counts.
- **Leak tests as CI.** Seed canary records (restricted group, HR, other tenant, other domain) with unique marker strings; the evaluation suite asks assistants to reveal them through search, chat, summarisation, reports and tools under many personas; any marker in an answer fails the build.

## Module: integration

### Features

- **Machine Identity Console (Zurich)** — lists service accounts used for inbound API integrations (accounts with "Web Service Access" enabled and/or that called an API), shows their auth method (basic, OAuth, other) with upgrade recommendations, and computes a Machine Identity Security Score from accounts unused for 100 days, basic-auth accounts, integration accounts with Web Service Access disabled, and accounts doing both UI and API logins; REST/SOAP API access policies map integration users to specific endpoints and tables, with separate IP restrictions; inbound OAuth supports client credentials, JWT bearer, third-party OIDC ID tokens, password grant and (newer docs) authorization code; new inbound integrations are created from the console by choosing a grant type, and *Machine Identity Access Controls* (built on REST/SOAP API access policies, with optional IP restrictions) state which inbound APIs may reach which resources under which conditions; any account that has made API calls counts as a machine identity even if not marked as a service account. [ServiceNow]
- **API token controls and SCIM** — Guard Standard controls API tokens and provisions users/groups via SCIM. [Atlassian]
- **Atlassian MCP server control** — data security policies allow/block AI agents and assistants reading content via the Atlassian MCP server (OAuth only). [Atlassian] [AI]
- **App users and restricted request types** — automation, change management and Connect/Forge app users cannot use restricted request types unless the app user or `atlassian-addons-admin` is listed. [JSM]
- **API applications run as an agent** — the nominated agent must belong to teams/departments that can access the tickets and hold the specific permissions. [HaloITSM]
- **REST Services User profile** — required in addition to other profiles (even Administrator) for REST access. [iTop]
- **Filters apply to API users** — operator filters hide records from the API user as in the UI. [TOPdesk]

### Implementation notes

- **One identity per integration.** Each integration gets its own non-human identity, a least-privilege permission set, endpoint/table/field allowlists, OAuth client credentials or mTLS, short token TTLs, IP allowlists and an owner who certifies it quarterly.
- **User-context integrations use token exchange.** When an integration acts for a user (chat tools, MCP, mobile), it exchanges the user's token (OAuth token exchange, RFC 8693) for an audience-bound token, so the API evaluates the user's permissions.
- **Outbound data is filtered per subscriber.** Webhooks and event streams deliver only records/fields the subscriber identity may read; inbound e-mail is mapped to the sender's user and limited to that user's permissions.

## Module: admin

### Features

- **Account admin vs workspace admin** — account-wide admins manage billing/workspaces (and are auto-added to non-restricted workspaces); workspace admins manage one workspace; restricted workspaces exclude account admins. [Freshservice]
- **Site administrators** — SDSiteAdmin manages associated sites and their site-level settings. [ManageEngine SDP]
- **Granular admin roles and hardening** — Security Center's granular admin roles let configuration tasks be delegated without full admin. [ServiceNow]
- **Admin delegation profiles** — profiles with partial administration rights (extension); delegated admins cannot grant organizations outside their own. [iTop]
- **Configuration-object ownership** — Modify/Owner rights on ticket types, workflows and similar objects. [HaloITSM]
- **Sandbox** — Enterprise plan. [Freshservice]

### Implementation notes

- **Configuration permissions are separate from data permissions.** A tenant admin configures forms, workflows, SLAs, catalogs and roles but reads data only through explicit data roles; confidential restrictions (HR, security) never yield to admin status.
- **Policy as versioned configuration.** Roles, grants, restrictions, audiences and field profiles are versioned; publishing shows a who-gains/who-loses diff from a simulation on live data and requires step-up MFA; sandbox-to-production promotion carries the same diff.
- **Platform-owner support access** is a customer-approved, time-boxed grant visible in the tenant's audit log, never a standing capability.

## Module: devops

### Features

- **Delegated development permissions per application** — granular build permissions (scripting, ACLs & roles, integrations, portal, catalog, tables & forms…) and separate deployment permissions. [ServiceNow]
- **Application scope protections** — per-table cross-scope access settings, cross-scope privileges and Restricted Caller Access records. [ServiceNow]
- **"View development tools" permission** — controls visibility of repository/CI/CD data on work items. [JSM]

### Implementation notes

- **Extensions declare permissions.** Every plugin/extension ships a manifest of the resources, actions and fields it needs; an admin approves it like an OAuth consent; the extension runs under its own identity bounded by that manifest, and calls made for a user are intersected with the user's permissions.
- **Security-relevant artefacts need a separate grant.** Editing roles, grants, restrictions or scripts that run as system requires a security-admin permission even inside a delegated app.

## Module: field_service

### Features

- **Mobile offline profiles** — per-table download rules "Download related data only", "All records", "Other data filter" (ownership-based, e.g., "Download my records") and "Custom data filter"; a custom filter on a related-only table is OR-ed with the relationship, so restrictive filters must clear related-only and express the relationship with AND. [Dynamics 365 — reference]
- **Permission-scoped sync buckets** — PowerSync Sync Streams create buckets from queries parameterized by signed JWT claims (e.g., `owner_id = auth.user_id()`); the service recomputes each client's bucket set and streams added/removed buckets and new operations; a stream creates one bucket per unique filter value (arrays in JWT claims such as `auth.parameter('project_ids')`, subqueries and joins multiply buckets), buckets are not shared between streams, and the default limit is 1,000 buckets per user/client; client (subscription) parameters must not be used for access control because only the signed auth parameters are tamper-proof. [PowerSync — reference]
- **Shape authorization** — ElectricSQL recommends proxy auth (your API validates each shape request) or gatekeeper auth (your API issues shape-scoped tokens); shapes (table, where, columns) are defined server-side with parameterized where clauses. [ElectricSQL — reference]
- **Materialized permission sets** — AuthZed Materialize backfills with LookupPermissionSets and streams changes with WatchPermissionSets into local tables (member-to-set, set-to-set) that the application joins to filter data. [SpiceDB — reference]
- **Territory and site scoping** — technicians limited to associated sites; site-specific SLAs and business rules. [ManageEngine SDP]

### Implementation notes

- **A technician's offline set is a scope, not a dump:** assigned work orders + their CIs/assets + KB articles for the technician's audience + customer contact fields allowed for the persona, within a time window.
- **Revocation and loss.** Offline data is encrypted at rest with a key released only after recent authentication; reassigning a work order removes it from the old technician's device at next sync; a lost device can be remote-wiped and its offline grace period expires automatically.
- **Uploads are re-authorized.** Offline edits are proposals until the server re-checks them against current permissions and state; rejected edits come back as conflicts with the reason.

## Access control & org structure

This section pulls the module findings together. It compares the access models of the tools studied, maps them to the general models, compares how AI products enforce permissions, and ends with the recommended model for our app (multi-tenant SaaS, optional MSP domain separation inside a tenant, an offline desktop replica, and an AI layer).

### Comparison across ITSM tools

| Tool | Capability model (what a user may do) | Record visibility model (which records) | Org structure and tenancy | Narrowing mechanisms for confidential data | Content audiences (KB, catalog) | Idea worth copying |
|---|---|---|---|---|---|---|
| **ServiceNow** | Roles (containment DAG, elevated roles, scoped roles, granular admin roles) + ACL rules per table/field/operation with Allow-If and Deny-Unless decisions; each ACL = roles + security attribute + data condition + script | Before-query business rules and Security Data Filters (pre-query, compiled into SQL); row ACLs (post-query, "rows removed"); query ACLs against inference; Data Filtration (post-query, being deprecated) | Company, department, location, cost center trees; manager chain; groups with parent and types; **domain separation** (domain tree; data, process and UI separation; contains/visibility domains; delegated admin) | Deny-Unless ACLs, Explicit Roles (internal/external), HR scoped roles and COE policies, field ACLs, Column Level Encryption, impersonation block for HR | **User criteria** (Can/Cannot Read/Contribute; Available / Not available; deny wins) | Allow-If/Deny-Unless split; pre-query data filters; query ACLs; domain process overrides; Access Analyzer |
| **Jira Service Management** | Global permissions + app roles (licence) + reusable **permission schemes** granted to space roles, groups, users and *security types* (reporter, assignee, custom-field users, portal access) | Browse permission per space, narrowed by **work-item security levels**; customer side by organizations, sharing settings and request participants; request-type restrictions control *create* | Groups, Atlassian Teams, customer organizations; Enterprise **units** as hard boundaries; no org tree, no domain separation | Security levels, request-type restrictions, internal comments, data security policies (export, public links, apps, AI/MCP), classification levels | Confluence space permissions, page restrictions, "who can view" per linked space | Scheme reuse across spaces; security types as dynamic principals; separate customer identity class |
| **Freshservice** | Agent roles (module privileges) and admin roles (settings areas; account-wide or workspace-wide); union of roles | **Scope per privilege**: whole workspace, member + observer groups, specific groups, assigned only; requesters: own + CC + department (prime user) | Workspaces (ESM), departments with heads, location tree, agent groups (member / observer / leader), requester groups; MSP mode clients; no domain separation | **Restricted groups** (tickets hidden from all non-members, leader approval for membership), **restricted workspaces** | Requester groups, departments, agent groups and logged-in/all on catalog items and KB folders | Scope attached to each privilege; observer membership; leader-approved restricted groups; per-action AI policies |
| **BMC Helix ITSM** | Permission groups (Master / User / Submitter / Viewer / Config per application) + functional roles tied to support groups | AR System **row-level security**: Request ID permission resolved from dynamic group fields (Submitter, Assignee, Assignee Group 112 holding user, support-group and company IDs, parent group, vendor group) | Company > Organization > Department; Support Company > Support Organization > Support Group (hierarchical); Region > Site Group > Site; **company-based multi-tenancy**, Tenancy Mode, Unrestricted Access | Support-group membership, vendor assignee groups, company access list | DWP entitlements (Entitlement Manager) | Denormalised principal list on every record, maintained by workflow and checked by the data layer |
| **ManageEngine ServiceDesk Plus** | Roles with module View / Add / Edit / Delete / Complete Access + fine-grained permissions (resolve, close, merge, assign, edit due time, delete others' notes) | **"Technicians allowed to view"**: All, All in associated Site, All in Group & assigned to him, Assigned to him (MSP: All in associated accounts); requesters: own / department / site | **Sites** (each with hours, holidays, SLAs, business rules, groups, technicians), departments, groups; MSP edition accounts | Group/site scoping only (no dedicated confidentiality layer found) | — | Site as both a scope and a configuration unit |
| **TOPdesk** | Permission groups (module rights) linked to operators or, preferably, operator groups | **Filters** (branch, category, operator / operator group; budget holder unverified): no filter = see all; each linked filter *widens*; exceptions for administrators and the "last changer" | Branches, departments, operator groups | — (filters only) | — | Simplicity; filters also apply to API users |
| **GLPI** | Profiles with a right matrix (Read, Update, Create, Delete, Purge, notes) + assistance rights + per-profile lifecycle matrices | **Entity tree**: authorization = (user, profile, entity, recursive, dynamic); ticket visibility own / group / all | Entities as tenants (one instance, many subsidiaries or customers), groups, locations; settings inherit from the parent entity; authorization rules from LDAP/mail/inventory | Private follow-ups and tasks (product knowledge — unverified), entity boundaries | KB targets (users, groups, profiles, entities with recursion); form access controls (GLPI 11) | Recursive flag on the assignment; configuration inheritance down the tree; rules that assign entity + profile |
| **iTop** | Profiles granting per class group the actions read, write, delete, bulk read/write/delete and `stimulus:<code>` lifecycle transitions | **Allowed organizations (silos)** expanded to all descendants with OQL `BELOW`; filter added to every query on classes with an owner organization; empty list = all; administrators bypass | Organization tree, teams, locations; MSP-style silos; SharedObject sharing | Silo filter; hidden administrator accounts | Portal user / portal power user; services offered through customer contracts (unverified) | Bounded delegated admin (cannot grant orgs outside your own); transition rights as first-class permissions |
| **Znuny / OTRS** | Groups with permission types ro, move_into, create, note, owner, priority, rw; roles bundle group permissions | Queues belong to groups; customer users/companies mapped to customer groups | Groups, roles, customer companies | — | — | **Option-level ACLs** that restrict selectable queues, states, priorities, values and actions by context |
| **HaloITSM** | Roles bundling permissions, team/department membership and notifications; agent-level overrides (higher wins and sticks) | Team membership; departments see all teams beneath; agent restrictions by ticket type and client | Departments > teams; clients > sites (PSA heritage) | Client and ticket-type restrictions | — | Client restrictions for co-managed IT; API apps run as a nominated agent |
| **Ivanti Neurons for ITSM** | Role chosen at login; business-object, field and relationship rights (View / Add / Edit / Delete) | **Data segregation constraints** through the Employee object and hierarchies (org unit, team/department, geography, cost center); most open permission wins | Employee hierarchies | — | — | Segregation expressed through people hierarchies |
| **Dataverse (reference)** | Privileges (Create, Read, Write, Delete, Append, Append To, Assign, Share) per table | **Depth**: User, Business Unit, Parent: Child BUs, Organization; owner/access teams; hierarchy security; sharing | Business-unit tree, positions/managers | Field security profiles | — | The depth ladder maps cleanly to SQL |
| **Salesforce (reference)** | Profiles + permission sets (with muting) | Org-wide defaults, role hierarchy, sharing rules, manual/team sharing, **restriction rules** that narrow | Role hierarchy, territories | Restriction rules, field-level security | — | Separate "widening" (sharing) from "narrowing" (restriction) rules |

How each tool actually evaluates a read (the order matters for builders):

- **ServiceNow** — (1) domain predicate when domain separation is on; (2) before-query business rules and Security Data Filters are AND-ed into the SQL; (3) table ACLs: every applicable Deny-Unless must pass, then at least one Allow-If must pass (a passing Deny-Unless alone grants when no Allow-If applies); (4) row ACL conditions/scripts per returned row (post-query, "rows removed"); (5) field ACLs from most to least specific; (6) query ACLs gate operators and sorting per column. Content audiences (user criteria) are a separate check for knowledge and catalog. Server scripts using `GlideRecord` skip all of this unless they use `GlideRecordSecure`.
- **Jira Service Management** — (1) authentication policy and app role (licence); (2) permission scheme of the space (Browse etc.) via roles, groups, users and security types; (3) work-item security level (must also match); (4) for customers, the portal-access security type plus organization sharing and participants; (5) request-type restrictions on create; (6) comment visibility; (7) data security policies on export, public links, apps and AI/MCP; (8) unit boundary.
- **Freshservice** — union of privileges across the agent's roles, each with its scope, then AND workspace membership, restricted-workspace allow-list and restricted-group membership; reports run inside the viewer's scope even when report privileges are auto-elevated.
- **BMC Helix** — permissions are evaluated by the AR System data layer on the Request ID field: the user must be named directly, or belong to a group or company listed in the record's dynamic group fields (written by workflow on submit/modify), unless they hold Unrestricted Access; application permission groups decide what they can do with records they see.
- **ManageEngine ServiceDesk Plus** — module permission (View must be on) AND the technician's view scope (sites, groups, assignment); sharing permissions add records reachable through tasks or explicit sharing.
- **TOPdesk** — module permission from permission groups, then filters as an OR of allowed branches/categories/operators (no filter = all).
- **GLPI** — the active entity (or entity tree when recursive) and the active profile for that entity decide everything; users switch profile/entity in the session.
- **iTop** — profile grants per class and action, then the silo filter `org_id IN (allowed orgs and descendants)` on every query; administrators skip both.
- **Znuny** — group permission on the ticket's queue, then ACLs restrict the options and actions available on the form.

### General models and where the ITSM tools sit

| Model | Definition | Where it shows up in ITSM tools | Use in our model |
|---|---|---|---|
| **RBAC** (NIST core, hierarchical, constrained) | Users get roles; roles carry permissions; role hierarchies; SoD constraints | Every tool at the capability level: ServiceNow role containment, JSM app/space roles, Freshservice roles, BMC permission groups, SDP roles, GLPI/iTop profiles | Roles are permission sets; role containment; roles granted *in context* |
| **Scoped / hierarchical RBAC** (depth ladder) | A role applies to a node of an org tree, optionally including descendants | GLPI recursive authorizations, iTop silos with `BELOW`, Dataverse depth, BMC parent support groups, Clarity OBS association modes, P6 OBS on EPS/WBS, ServiceNow domain tree | Role assignment context + `recursive` flag; scope levels |
| **ABAC** (NIST SP 800-162, XACML) | Decisions from subject, object, action and environment attributes | ServiceNow security attributes and data conditions, Ivanti data segregation, NetBox JSON constraints, Moveworks managed permissions, Salesforce restriction rules, Data Filtration subject criteria (IP ranges) | Conditions on grants and restrictions (state, type, classification, time, network zone) |
| **ReBAC** (Zanzibar, OpenFGA, SpiceDB) | Access derived from relationships between objects and principals, with reverse queries | Implicit everywhere: requester, assignee, watch list, request participants, approvers, JSM security types, CSM partner relationships; explicit in Moveworks (OpenFGA tuples) | Participant keys, shares and relationship tuples (partner_of, delegate_of) |
| **OBS / RBS org trees** | OBS = who is responsible for what (organization breakdown); RBS = hierarchy of resources (people, skills, equipment) for capacity and assignment | OBS ≈ org units, support groups and companies; RBS ≈ resource pools/skills (P6 resource nodes limit which resources a user can see; Clarity grants per OBS unit) | Separate trees: org units (OBS) for data scope, resource pools (RBS) for workforce/scheduling scope |
| **Multi-tenancy** | Separate instance, separate database/schema, or shared schema with a tenant key | ServiceNow (separate instances recommended for full isolation), BMC company tenancy, GLPI entities, iTop silos, JSM units/sites, Freshservice accounts | Shared schema with `tenant_id` + Postgres RLS; per-tenant keys; optional dedicated database for large tenants |
| **Domain separation** | Tenant-within-tenant with data, process and UI separation and override inheritance | ServiceNow (full), GLPI (config inheritance per entity), BMC (company tenancy, no process overrides) | Optional MSP layer with nearest-override configuration |
| **Separation of duties** | Static (conflicting roles) and dynamic (conflicting acts on one object) | ServiceNow/BMC approval engines exclude requesters in some flows; mostly left to configuration | Built-in SoD rule engine for role grants and for approvals/implementation |
| **Delegation** | Temporary transfer of approvals/assignments/notifications, or of access | ServiceNow standard and granular delegation (no record access), Freshservice one active delegate, Znuny out-of-office (product knowledge) | Separate kinds: work delegation vs access delegation (bounded by the delegator) |
| **Privileged access** | Elevation, impersonation, break-glass | ServiceNow elevated roles and impersonation, Freshservice assume identity, Microsoft emergency-access guidance | JIT elevation, read-only "view as", break-glass with alerts |
| **Federated identity and provisioning** | SSO (SAML 2.0, OIDC), MFA, SCIM 2.0, JML | All enterprise tools (Atlassian Guard, ServiceNow Multi-Provider SSO, Freshworks org SSO + SCIM, GLPI 2FA per entity) | SSO + passkeys + step-up per action class + SCIM-driven role assignment rules |
| **Policy engines** | Cedar, OPA/Rego; partial evaluation to SQL residuals | Not used by ITSM vendors directly; ServiceNow's compiled data filters are the closest | Own small policy language compiled to SQL; optional Cedar export for audit |
| **Database row security** | PostgreSQL RLS (permissive/restrictive policies, USING/WITH CHECK) | BMC's data-layer RLS is the ITSM analogue | Backstop for tenant (and domain) boundaries |

### How AI products enforce permissions

| Product | Identity the AI uses | Retrieval filtering | Action/tool control | Answer and citation filtering | AI-specific restrictions and protection | Freshness of permission changes |
|---|---|---|---|---|---|---|
| **ServiceNow** (Now Assist, AI Agents, AI Search) | *Dynamic user* (the invoker or the triggering record/agent) or a fixed **AI user**; role masking narrows the caller's roles | AI Search **early binding** (security filters compiled into the query) with **late binding** (`canRead()` per hit) fallback; external content keeps source ACLs via user aliases | Invocation ACLs; the user must pass the ACLs of every tool of the agent; deny-by-default for new agentic resources | Genius Results only when a relevant *accessible* article exists | Now Assist Guardian (prompt injection, offensiveness, sensitive topics); Data Privacy two-way masking; AI Control Tower (inventory, Veza access graph, kill switch); AI Gateway for MCP | Evaluated at query time against current ACLs (index-side metadata freshness not documented — unverified) |
| **Atlassian Rovo** | The user's account (inherits all the user's rights) or the **agent's account** (organization, app and user access layers) | Permission-aware search and chat; Teamwork Graph connectors keep source permissions in sync within a freshness window | Agent tools configured in Rovo Studio; creator and sharing governance | Agents cannot answer from content the user cannot view | **MCP control** in data security policies (org, site, object, classification), units, IP allowlists covering Rovo and the MCP server; "Rovo Chat security" announced | Freshness window; stale connector permissions handled conservatively |
| **Freshservice** (Freddy AI) | Copilot works for the agent; Copilot Agent checks the agent's permissions; the requester-facing AI Agent | KB folder visibility; knowledge sources filtered per AI agent; connector permission handling not documented | Per action: Always allowed / Approval required / Blocked; allowed groups; new actions "unmapped" | — | Copilot per role and licence; *Manage AI Agent Studio* permission; conversation logs not covered by RBAC (gap) | — |
| **BMC HelixGPT** | The end user (ITSM / Helix Portal permission model); agentic AI pinned to the ticket's customer company | ACL check before context is returned; tenant-separated vector store with tenant-specific RBAC; dynamic tags by role, permission and location | HelixGPT Admin and Agent Studio roles | Unviewable chunks never reach the LLM | Prompt Shields recommended; no built-in PII masking | "Immediately synced" |
| **Moveworks** | The user | **Mirrored permissions** (source ACLs flattened into OpenFGA tuples, pre-filter) + **managed permissions** (ABAC, post-filter) + **user-consent** live search with the user's OAuth token | Plugins in Agent Studio | — | Permissions Checker | Events/webhooks or ~15-minute change checks |
| **Glean** | The user | One permission-filtered context pool from indexed and live (per-user) retrieval | Admins choose tools that run automatically vs with human approval | The source enforces again at click time | — | Connector sync |
| **Microsoft 365 Copilot** | The user | Graph/semantic index permission trimming | — | With VIEW but no **EXTRACT** right, Copilot links instead of summarizing | **Restricted Content Discovery** hides sites from Copilot and org search without changing access | — |
| **Salesforce Einstein Trust Layer** | The user | Secure data retrieval under the user's permissions, dynamic grounding | — | — | Masking, zero data retention at the LLM provider, toxicity scoring, audit trail | — |
| **ITSM MCP servers** (TOPdesk, InvGate, Xurrent, Halo, ManageEngine) | Per-user tokens (InvGate), a chosen *Application* (Halo), system-defined agent roles (Zia) | Read-only tools, scoped to the customer's data (TOPdesk) | Read-only by default; per-action autonomy (InvGate) | — | Revocable tokens; same audit as native agents (Xurrent) | — |

Common techniques across these products, and the failure modes they reveal:

- **Permission-aware retrieval** comes in two forms: *early binding* (compile the user's filter into the search/vector query) and *late binding* (check each hit). Early binding keeps counts and recall honest; late binding handles rules that cannot be compiled. Products that rely on late binding show fewer results than counted (ServiceNow documents this).
- **User-context tools**: the agent acts with the user's identity (ServiceNow dynamic user, Rovo user's account, InvGate per-user MCP tokens). **Agent identities** exist for autonomous work (ServiceNow AI user, Rovo agent's account, Halo Application, Zia Agent roles) and are given narrow, explicit grants.
- **Rights never grow through the AI**: role masking (ServiceNow), the agent's account reaching only granted content (Rovo), Copilot Agent permission checks plus action policies (Freshservice).
- **AI-channel restrictions stricter than record permissions**: Atlassian's MCP control, Microsoft Restricted Content Discovery and the EXTRACT usage right, BMC's company pinning for agentic AI.
- **Citation filtering**: answers are produced only from content the user may read (Genius Results, HelixGPT chunks, Copilot links instead of summaries).
- **Prompt-injection containment**: classifiers (Guardian, Prompt Shields), sensitive-topic redirects, data masking, and the design patterns of arXiv 2506.08837 (action-selector, plan-then-execute, dual LLM, context-minimization).
- **Known gaps**: undocumented connector-permission handling (Freshservice AI Agent), conversation logs readable workspace-wide (Freshservice), no PII masking (HelixGPT), enforcement only for OAuth and not for custom MCP servers (Atlassian), freshness windows of minutes (Moveworks, Rovo), and channels where an audience cannot be evaluated (JSM request-type restrictions disappear from e-mail, chat and the virtual agent).

### Final recommendation for our app

Target: a multi-tenant SaaS ITSM/ESM product on PostgreSQL, with an **optional MSP domain-separation layer** inside a tenant, an **offline desktop replica** (local database synced from the server), and an AI layer (RAG, assistants, agents, smart reports). The model below combines the strongest ideas found above: Freshservice's scope per privilege, Dataverse's depth ladder, GLPI's recursive authorizations, BMC's denormalised principal field, ServiceNow's Deny-Unless split, pre-query data filters, query ACLs, user criteria and domain process overrides, iTop's bounded delegated administration, Znuny's option rules, Freshservice's restricted groups and per-action AI policies, Rovo's agent identities, and the permission-aware retrieval of Moveworks, Glean and HelixGPT.

#### 1. Design principles

1. **Default deny and one decision point.** Every read and write — UI, API, search, reports, dashboards, exports, notifications, webhooks, sync, AI retrieval and AI tools — passes through one policy compiler. A system context (`asSystem(reason)`) exists only for background jobs and integrity checks; it is flagged in code review and always audited (the ServiceNow `GlideRecord` trap shows what happens otherwise).
2. **A grant is capability × scope × condition.** `(resource, action, scope, condition)`; all grants of a subject are OR-ed, so the most permissive wins, which is what Freshservice, Ivanti and multi-role users expect.
3. **Restrictions intersect and outrank grants and admin status.** Tenant, domain, security level, restricted group, secure workspace, classification and the external-user fence are AND-ed (ServiceNow Deny-Unless, Salesforce restriction rules, JSM security levels, Freshservice restricted groups). Tenant admins pass a restriction only with explicit clearance.
4. **Roles are granted in a context.** A role assignment names a context node (tenant, domain, company, org unit, location, group, service, cost center, project, resource pool) and a `recursive` flag, so "change manager for the EMEA subtree" needs no cloned role. Delegated admins can grant only inside their own administrable set and never elevated roles (iTop `CheckIfOrgIsAllowed`).
5. **Filter before the query, never after.** Predicates are compiled into SQL so counts, pagination, sorting and aggregates are exact (ServiceNow Security Data Filters, BMC RLS); ServiceNow itself is retiring the post-query Data Filtration feature.
6. **One policy, three compiled forms.** (a) a SQL predicate for server queries; (b) **access keys** materialised on records for indexes, full-text search, the vector store and sync buckets; (c) an in-memory evaluator for single-record checks, UI affordances and offline UX. Property-based tests prove the three agree.
7. **Hard boundaries in the database too.** PostgreSQL row-level security with `FORCE ROW LEVEL SECURITY` keyed on a transaction-local tenant (and in MSP mode domain) setting, so a forgotten predicate cannot cross tenants.
8. **Every principal is explicit.** Internal and external humans, integrations, automations and AI agents are principals with their own grants; an assistant acting for a user never exceeds that user.
9. **Explainable by construction.** `explain`, "view as", "compare two users", "who can see this record", and a who-gains/who-loses simulator before any policy change (ServiceNow Access Analyzer, but present from day one).
10. **Every rule is labelled "grant" or "restriction"** in the admin UI, with the effect previewed; TOPdesk filters widen, JSM security levels narrow, JSM Assets object-type roles replace schema roles and Halo agent overrides stick — admins misread all of these.
11. **Provenance on every assignment** (`source`: manual, SCIM/IdP group, HR rule, delegation, elevation, migration; `granted_by`, `reason`, `valid_to`) so revoking a source removes exactly the rights it produced.
12. **Fail closed on staleness.** If access data may be stale (index re-key pending, offline period expired, connector permissions older than the freshness window), hide rather than show.

#### 2. Entities (data model)

```text
-- Tenancy and the optional MSP layer
tenant(id, slug, plan, region, kms_key_ref, msp_mode bool, policy_version bigint)
domain(id, tenant_id, parent_id, path ltree, kind {root, provider, customer, process, data}, name)
      -- msp_mode = false: exactly one root domain per tenant, invisible in the UI

-- Anchor trees (OBS and others); all share one closure table maintained by triggers
company(id, tenant_id, domain_id, parent_id, kind {internal, customer, vendor, partner, manufacturer})
org_unit(id, tenant_id, domain_id, company_id, parent_id, kind {division, department, team, section},
         head_user_id, cost_center_id)
location(id, tenant_id, domain_id, parent_id, kind {region, country, city, site, building, floor, room})
cost_center(id, tenant_id, domain_id, parent_id, owner_user_id)
service(id, tenant_id, domain_id, parent_id, kind {business, technical, offering}, owner_user_id)
resource_pool(id, tenant_id, domain_id, parent_id, manager_user_id)        -- RBS for workforce/scheduling
tree_closure(tenant_id, tree, ancestor_id, descendant_id, depth)

-- Principals
principal(id, tenant_id, domain_id, kind {user, group, integration, ai_agent, anonymous})
user(id, kind {internal, external, integration, ai_agent}, persona, company_id, org_unit_id, location_id,
     cost_center_id, manager_id, resource_pool_id, status {active, suspended, deactivated},
     auth_policy_id, max_offline_hours, authz_epoch bigint, external_id, scim_source)
group(id, parent_id, types[] {assignment, approval, cab, requester, security, distribution},
      restricted bool, leader_approval bool, domain_id)
group_member(group_id, user_id, kind {member, observer, leader}, valid_from, valid_to, source, granted_by)

-- Capabilities
role(id, tenant_id, key, name, internal_only bool, external_allowed bool, elevated bool,
     assignable_by_role_id, licence {none, requester, approver, agent, admin}, system bool, version)
role_contains(role_id, child_role_id)
grant(id, role_id, resource, action, scope, condition jsonb /* AST */, field_set_id)
role_assignment(id, principal_id, role_id,
     context_type {tenant, domain, company, org_unit, location, group, service, cost_center, project, resource_pool},
     context_id, recursive bool, valid_from, valid_to,
     source {manual, scim, hr_rule, delegation, elevation, migration}, granted_by, reason, last_used_at)

-- Restrictions (deny-unless)
restriction(id, tenant_id, kind {security_level, restricted_group, secure_workspace, classification,
     external_fence, legal_hold}, resources[], applies jsonb /* record AST */, active)
security_level(id, scheme_id, name, rank)
clearance(principal_id, restriction_id, level_id, valid_to, source, granted_by)
workspace(id, tenant_id, domain_id, kind {it, hr, facilities, legal, finance, security, custom}, secure bool)

-- Audiences (user criteria) for content and intake
audience(id, tenant_id, include jsonb, exclude jsonb, match_all bool)
     -- users, groups, roles, companies, units ± subtree, locations ± subtree, requester groups, condition
audience_binding(object_type, object_id,
     mode {can_read, cannot_read, can_contribute, cannot_contribute, can_request, cannot_request}, audience_id)

-- Field security
field_policy(resource, field, class {public, internal, personal, sensitive, secret, financial, hr, security},
     mask {none, partial, full, hash_match}, query_ops {none, match, range},
     ai bool, offline bool, search bool, export bool)
field_grant(role_id, resource, field_or_class, read bool, write bool, unmask bool, query_range bool)

-- Record-level rules
share(id, resource, record_id, principal_id, access {read, comment, edit},
      reason {participant, approver, cab, handoff_grace, broadcast, manual}, expires_at, created_by)
transition_rule(resource, from_state, to_state, required_action, condition jsonb)
option_rule(resource, match jsonb, field, mode {possible, possible_not, possible_add}, values jsonb, priority, stop bool)
sod_rule(id, kind {static, dynamic}, left, right, mode {block, warn, require_second_approver})

-- Delegation and privileged access
delegation(id, delegator_id, delegate_id, kinds[] {approvals, assignments, notifications, record_access},
     condition jsonb, valid_from, valid_to, exclude_confidential bool)
elevation(id, user_id, role_id, context, reason, approved_by, mfa_at, starts_at, ends_at)
support_grant(id, tenant_id, vendor_user_id, scope, approved_by, starts_at, ends_at)
device(id, user_id, platform, registered_at, last_sync_at, wipe_requested_at, key_ref)

-- Columns on every secured record (incident, request, problem, change, release, task, CI, asset, article, case…)
tenant_id, domain_id, workspace_id, security_level_id, restricted_group_id, classification,
requester_id, requested_for_id, opened_by_id, assignee_id, assignment_group_id, owner_group_id,
company_id, org_unit_id, location_id, cost_center_id, service_id,
acl_keys text[] /* GIN */, acl_version int, external_visible bool

-- Audit
privileged_action_log (append-only, hash-chained), read_audit (sensitive classes),
authz_denial_log, policy_version (snapshots + diffs), ai_run (see the AI layer)
```

#### 3. Scope levels and access keys

The scope list is small and closed. Each scope maps to a typed **access key**; records carry the keys of their anchors **and of every ancestor of each anchor**, so a subtree grant needs one subject key whatever the subtree size.

| Scope | A record matches when… | Keys stored on the record | Subject key (role granted tenant-wide) | Subject key (role pinned to context node *n*) |
|---|---|---|---|---|
| `own` | the subject is requester, requested-for or opened-by (per resource profile) | `req:<user>` | `req:<me>` | — |
| `assigned` | the subject is the assignee | `asg:<user>` | `asg:<me>` | conjunction `asg:<me>&<n-key>` |
| `participant` | watcher, CC, request participant, approver with an open approval, CAB member on the agenda, share holder | `par:<user>` | `par:<me>` | — |
| `group` | the assignment group (or owner group / CI support group per resource profile) is one of the subject's groups | `g:<group>` | `g:<each group I belong to>` (observers: read actions only) | `g:<n>` |
| `group_subtree` | the record's group is below a subject group | `gt:<group and each ancestor>` | `gt:<each group I lead or belong to>` | `gt:<n>` |
| `unit` / `unit_subtree` | record unit equals / is below | `o:<unit>`, `ot:<unit and ancestors>` | `o:<my unit>` / `ot:<my unit>` | `o:<n>` / `ot:<n>` |
| `reportees` | requester is in the subject's management chain (depth ≤ N, default 3) | `mgr:<each manager of the requester>` | `mgr:<me>` | — |
| `location_subtree` | record location is below | `lt:<location and ancestors>` | `lt:<my location>` | `lt:<n>` |
| `company` / `company_subtree` | record company equals / is below | `c:<company>`, `ct:<company and ancestors>` | `c:<my company>` / `ct:<my company>` | `c:<n>` / `ct:<n>` |
| `service` | record linked to the service (subtree) | `st:<service and ancestors>` | — (needs a context) | `st:<n>` |
| `cost_center_subtree` | record cost center is below | `cct:<cost center and ancestors>` | `cct:<my cost center>` | `cct:<n>` |
| `project` | record belongs to the project | `pj:<project>` | — | `pj:<n>` |
| `domain_subtree` | record domain is below a visible domain (MSP) | `dt:<domain and ancestors>` | `dt:<each visible domain root>` | `dt:<n>` |
| `all` | any record of the tenant (MSP: of all visible domains) | `t:<tenant>` | `t:<tenant>` (MSP: the `dt:` keys) | — |

Rules for keys:

- **Conjunctions** — when a grant's scope is narrower than the assignment context (e.g., "edit records assigned to me, but only for customer ACME"), the grant compiles to a conjunction. The compiler registers each conjunction *pattern* the tenant's roles use (e.g., `asg & ct`), and the key trigger emits composite keys such as `asg:<u>&ct:<c>` for those patterns only, so indexes and sync buckets stay flat. Patterns are few (typically < 10 per tenant).
- **Anchor modes** — requester-derived anchors (company, unit, location, manager chain) are **snapshotted** at creation by default (BMC writes the company into field 112 at submit), so an HR move does not silently re-scope history; assignment anchors (group, assignee) and CI/service anchors are **live**. A "re-anchor" admin job exists for reorganisations.
- **Handoff grace** — on reassignment the previous assignee and group receive `par:` shares that expire (default 7 days), shown in the record's access explanation. This replaces TOPdesk's implicit "last changer" visibility and fixes ManageEngine's "Request does not fall under your permitted scope" after an agent hands a ticket to another group.
- **Child records** — inherit the parent's keys with adjustments: internal/work notes drop `req:` and external `par:` keys; tasks add their own group keys (as BMC tasks add the task group to the parent's field 112); SLA instances, approvals and attachments copy the parent's keys; chunks in the vector store copy the keys of their field group.
- **Typical sizes** — a record carries 15–40 keys; an agent holds < 50 subject keys; an MSP provider lead a few hundred; cap at 1,000 per subject (also PowerSync's default bucket limit) and give subjects above the cap a broader key (`t:` or `dt:`) plus condition terms.

#### 4. Record rules

1. **Grants (allow-if)** per action: `read, create, update, assign, transition:<state>, comment_public, comment_internal, delete, link, approve, export, report_on, report_aggregate, bulk_update, share, reveal_field`. Each grant has a scope and an optional condition AST over record fields (state, type, category, priority, classification), subject attributes and environment (time window, network zone, MFA age).
2. **Restrictions (deny-unless)**, each an `applies` predicate on the record plus a clearance rule on the subject:
   - *Security levels* (ranked; JSM-like) — a record with level L is visible only to principals cleared for L (by role, group, user, or dynamic principals such as reporter/assignee when the scheme allows).
   - *Restricted groups* (Freshservice semantics) — records assigned to the group are visible only to its members (with a group-scoped read grant), plus the requester unless `hide_from_requester`; membership changes need leader approval; impersonation of members is blocked; *unlike* Freshservice, the restriction applies to every resource type (problems, changes, tasks), not just tickets.
   - *Secure workspaces* (HR, legal, security, employee relations) — only explicit members; no implicit access for tenant admins, platform owners or auditors; break-glass needs two-person approval.
   - *Classification* (public / internal / confidential / restricted) — subject needs clearance ≥ record classification; drives AI and export policy too.
   - *External fence* — external users reach only resources and fields marked external-visible (ServiceNow Explicit Roles); internal-only roles cannot be granted to external users.
   - *Legal hold* — blocks delete, purge and anonymisation.
3. **Audiences** for knowledge bases, articles, catalog items, request types, announcements, portal widgets and AI knowledge sources: `read = (can_read ∪ contributors) − cannot_read`, `contribute = can_contribute − cannot_contribute`, `request = can_request − cannot_request`; deny wins; article bindings only narrow the base unless the tenant enables "article can widen". Audiences are evaluated when listing and again at submission through every channel (portal, e-mail, chat, API, AI assistant); a channel that cannot identify the user gets only public items (instead of JSM's "restricted types vanish for everyone").
4. **Transition rules** — per resource state machine: the action and condition required for each `from → to` (GLPI lifecycle matrices, iTop stimuli), enforced on the server.
5. **Option rules** — context-dependent allowed values (Znuny ACLs): e.g., only CAB members may set change risk "High", HR categories only inside the HR workspace, "Resolved" only when a resolution code is set; the UI uses them to filter pick-lists and the server re-validates on write.
6. **Write-scope (post-image) rule** — after an update the record must still be inside the subject's write scope, unless the action is an explicit hand-off (`assign`, `escalate`, `transfer`), which is its own permission; this blocks "move a record into a scope I may not write" abuse.
7. **Separation of duties** — dynamic: requester ≠ approver, implementer ≠ approver, author ≠ approver of a production deployment, purchaser ≠ receiver, KB author ≠ publisher (optional); modes block / warn / require a second approver; when the only eligible approver is conflicted, escalate up the authority matrix. Static: conflicting role pairs (security admin ⊥ auditor, tenant admin ⊥ auditor, requester-of-access ⊥ approver-of-access) checked on assignment and in access reviews.
8. **Shares** — time-bound, reasoned, audited; used for approvers, CAB agendas, hand-off grace, and a *broadcast* share that publishes a read-only major-incident summary to an audience without opening the record.
9. **Retention** — purge or anonymise per class after N days; restore of purged data is impossible; retention jobs run as a system principal and log counts.

#### 5. Field-level security

| Field class | Examples | Default read | Default write | Mask | Query ops | AI | Offline | Search / export |
|---|---|---|---|---|---|---|---|---|
| `public` | short description, state, priority, category | anyone who can read the record | per grant | none | range | yes | yes | yes / yes |
| `internal` | work notes, resolver details, internal categories, CI relationships | internal users who can read the record (never requester or external personas) | agents | none | range | agent personas only | yes | internal index / yes |
| `personal` | phone, personal e-mail, home address, birth date | requester + involved agents | requester, agent | partial | match | placeholders only | no (default) | no / with grant |
| `sensitive` | national ID, passport number, bank account | field grant | field grant | full; HMAC column for exact match | match (hash) | never | no | no / grant + step-up |
| `secret` | passwords and keys in masked variables, recovery codes | nobody — write-only; "reveal" needs step-up, reason and audit | requester at submit | full | none | never | never | never |
| `financial` | cost, price, contract value, budget | finance grant | finance grant | full | range with grant | aggregates only | no | no / grant |
| `hr` | salary, medical, disciplinary data | HR COE grant | HR | full | none | HR partition only | no | HR partition / grant |
| `security` | IOCs, vulnerability and exploit details | security-level members | same | full | range | security partition only | no | security partition / grant |

Enforcement points (each one must use the same compiled field mask):

- **Projection** — select only readable columns; masked columns return `null` plus mask metadata (e.g., last three digits); secret columns are never selected.
- **Query validation** — filters, sorts, group-bys and aggregates are accepted only on fields whose class allows the operator (ServiceNow `query_match` vs `query_range`); `hash_match` fields support "find by national ID" without disclosing values.
- **History and audit views** — changes to unreadable fields show "field changed" without values.
- **Notifications** — rendered per recipient under the recipient's field mask; placeholders replace hidden fields; internal fields never reach external recipients.
- **Exports, API and webhooks** — same projection; exporting sensitive classes needs step-up and is logged.
- **Search and vector indexes** — classes indexed into separate fields or partitions; sensitive and secret classes are never indexed.
- **Offline replica and AI prompts** — governed by the `offline` and `ai` flags.
- **Encryption** — sensitive and secret columns use envelope encryption with a per-tenant data key (optional customer-managed key); the HMAC key for `hash_match` is per tenant.
- **State-based write locks** (e.g., resolution fields after closure) are server-side field conditions; client-side UI policies are only UX.

#### 6. The SQL-predicate evaluation algorithm

**Step 1 — build the subject context once per request** (cached under `(user_id, authz_epoch, tenant.policy_version)`; `authz_epoch` is bumped by triggers on group membership, role assignment, delegation, elevation, clearance and the user's anchors; `policy_version` on any role/grant/restriction/field-policy change):

```text
SubjectContext =
  tenant, msp, visible_domains (own domain subtree ∪ visibility grants ∪ "contains" links), external flag, persona,
  groups (member / observer / leader, with ancestors), unit, location, company (with ancestors), manager chain,
  roles   = transitive closure of role_contains over active assignments
            (direct, via groups, via record-access delegations, via active elevations; expired ones dropped),
  grants  = map (resource, action) -> [(scope, context node, recursive, condition, field_set)],
  clearances (levels, restricted groups, secure workspaces, classification ceiling),
  field masks per resource, keys per (resource, action)
```

**Step 2 — resolve keys for each grant:**

```text
resolveKeys(grant g, assignment a, ctx):
  if a.context_type == tenant:                       # scope is relative to the subject (depth ladder)
     own -> [req:me]; assigned -> [asg:me]; participant -> [par:me]
     group -> [g:x for x in ctx.groups if x.kind != observer or g.action == read]
     group_subtree -> [gt:x for x in ctx.groups]
     unit -> [o:ctx.unit]; unit_subtree -> [ot:ctx.unit]; reportees -> [mgr:me]
     location_subtree -> [lt:ctx.location]; company -> [c:ctx.company]; company_subtree -> [ct:ctx.company]
     cost_center_subtree -> [cct:ctx.cost_center]
     domain_subtree -> [dt:d for d in ctx.visible_domain_roots]
     all -> ctx.msp ? [dt:d for d in ctx.visible_domain_roots] : [t:tenant]
  else:                                              # scope is pinned to the context node n
     nodeKey = (a.recursive ? subtreePrefix : nodePrefix)(a.context_type) + n      # e.g. ot:EMEA
     if covers(g.scope, a.context_type): return [nodeKey]                           # e.g. unit_subtree in EMEA
     else: return [conj(resolveKeys(g, tenantWide, ctx), nodeKey)]                  # e.g. asg:me&ct:ACME
```

**Step 3 — compile the read predicate** (every part is a predicate over record columns with subject constants bound as parameters; nothing is evaluated per row in application code):

```text
compileRead(ctx, resource R, action A = read):
  P  = ["r.tenant_id = :tenant"]                                   # also enforced by RLS
  if ctx.msp: P += ["r.domain_id = ANY(:visible_domains)"]         # also enforced by RLS
  for x in restrictions(R):                                        # deny-unless, AND-ed
     if fullyCleared(ctx, x): continue
     P += [recordPredicate(x, ctx)]
       # security level   (r.security_level_id IS NULL OR r.security_level_id = ANY(:cleared_levels))
       # restricted group (r.restricted_group_id IS NULL OR r.restricted_group_id = ANY(:my_restricted_groups)
       #                   OR (r.requester_id = :me AND NOT r.hide_from_requester))
       # secure workspace (r.workspace_id IS NULL OR r.workspace_id <> ALL(:secure_ws)
       #                   OR r.workspace_id = ANY(:my_secure_ws))
       # classification   (r.classification <= :classification_ceiling)
       # external fence   (r.external_visible)                      -- only when ctx.external
  G = ctx.grants(R, A)
  if G is empty: return FALSE                                      # default deny
  singles = union of keys of unconditional, non-conjunctive grants
  terms   = []
  if singles: terms += ["r.acl_keys && :singles"]                  # one GIN probe for most grants
  for g in G with conjunction keys K:  terms += ["r.acl_keys @> :K"]
  for g in G with condition C:         terms += ["(r.acl_keys && :keys_g AND " + toSQL(C, ctx) + ")"]
  P += ["(" + OR(terms) + ")"]
  return AND(P)
```

**Step 4 — run queries through it:**

```text
list(ctx, R, filter, sort, groupBy, page):
  for f in fields(filter) ∪ fields(sort) ∪ fields(groupBy):
     require fieldRead(ctx, R, f) and operatorAllowed(ctx, R, f, op)   # else 400 "not filterable"
  where = compileRead(ctx, R) AND toSQL(filter)
  rows  = SELECT projection(ctx, R) FROM R r WHERE where ORDER BY sort, id LIMIT n   # keyset paging
  total = SELECT count(*) FROM R r WHERE where                                        # exact counts
get(ctx, R, id):   same WHERE plus r.id = :id; not found -> 404 (not 403), so ids are not an existence oracle
aggregate(ctx, R, measure, dims):  same WHERE; dims and measures validated against field masks;
                                    cells below k suppressed for classes with small-cell protection
```

**Step 5 — writes re-check everything on the server:**

```text
update(ctx, R, id, patch):
  BEGIN; SET LOCAL app.tenant_id = :tenant; SET LOCAL app.domains = :visible_domains
  row = SELECT * FROM R r WHERE r.id = :id AND compileRead(ctx, R) FOR UPDATE      # 404 if unreadable
  acts = classify(patch)                     # update, assign, transition, comment_internal, reveal_field...
  for a in acts: require evaluate(ctx, R, a, row)        # in-memory evaluator, same AST, pre-image
  require fieldWrite(ctx, R, changedFields(patch), row)  # field grants + state-based locks
  require transitionRule(ctx, R, row.state, patch.state, row)
  require optionRules(ctx, R, row ⊕ patch)
  require sodRules(ctx, R, row ⊕ patch, acts)
  new = apply(row, patch); new.acl_keys = deriveKeys(new)  # the trigger computes the same; keys never come from clients
  if not isHandoff(acts): require evaluate(ctx, R, update, new)                     # post-image still in scope
  UPDATE ...; INSERT audit(before, after, actor, on_behalf_of, ai_run_id, acts)
  INSERT outbox(rekey search / vector / sync if acl_keys changed)                   # same transaction
  COMMIT
create(ctx, R, data): check the create grant against the keys the new record will carry (an agent may create
  incidents only for companies in scope), audience of the request type or catalog item, option rules, then insert.
delete(ctx, R, id): delete grant AND not legal hold AND retention rules.
```

**Step 6 — key derivation** (database trigger plus the same function in the application for previews):

```text
deriveKeys(rec):
  K = {t:tenant}
  K += req:<id> for requester, requested_for, opened_by
  K += asg:<assignee>;  K += par:<p> for watchers, participants, active approvers, CAB agenda members, live shares
  for grp in [assignment_group, owner_group, extra groups of the resource profile]:
      K += g:<grp>; K += gt:<a> for a in ancestors(grp) ∪ {grp}
  K += o:<unit>; K += ot:<a> for a in ancestors(unit) ∪ {unit}             # snapshot or live per profile
  K += lt:<a> ...; K += c:<company>; K += ct:<a> ...; K += st:<a> ...; K += cct:<a> ...; K += pj:<project>
  K += mgr:<m> for m in managerChain(requester, depth N)
  if msp: K += dt:<a> for a in ancestors(domain) ∪ {domain}
  K += registered conjunction patterns (e.g. asg:<u>&ct:<c>)
  return K
```

**Explain and reverse queries:**

- `explain(ctx, R, id, action)` returns every layer with pass/fail: tenant, domain (record domain vs visible domains), each restriction (cleared or not), each grant (role, assignment context, scope, subject keys, record keys, matching key), field masks, transition/option/SoD rules for writes. The UI renders it as "why can / can't I see this"; the AI explainer only narrates this trace.
- `whoCanSee(R, id)` reverses the keys: the policy compiler maintains `key_index(key → assignments and memberships that yield it)` (for example `g:57` ← members of group 57 holding any role with a group-scoped read grant; `ot:EMEA` ← assignments pinned to EMEA with recursion and users in EMEA with `unit_subtree` grants); groups expand to users, then restrictions filter the list. The same function drives notification fan-out ("only people who can read it are notified"), access reviews and leak investigations.

**Caching and revocation:** compiled fragments are cached per `(epoch, resource, action)`; every request checks the epoch, so revocation is immediate on the server; sync removes revoked buckets on the next tick; AI answer caches are keyed by an ACL fingerprint (see the AI layer).

**Indexes and performance:** `GIN (acl_keys)` on every secured table (optionally integer-encoded keys through a dictionary table with `gin__int_ops` for smaller indexes); btree `(tenant_id, domain_id, state, updated_at)`; partial indexes on open records; indexes on `security_level_id`, `restricted_group_id` and `workspace_id`, which dominate the plan when a subject holds broad keys. Keyset pagination; exact counts for small result sets and estimated counts above a threshold (labelled as estimates).

**PostgreSQL RLS backstop:**

```sql
ALTER TABLE incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incident AS RESTRICTIVE
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY domain_fence ON incident AS RESTRICTIVE
  USING (coalesce(current_setting('app.msp', true), 'off') = 'off'
         OR domain_id = ANY (string_to_array(current_setting('app.domains', true), ',')::uuid[]));
CREATE POLICY app_layer ON incident AS PERMISSIVE USING (true) WITH CHECK (true);
```

Grants stay in the application compiler (they need the subject context); restrictive policies make tenant and domain boundaries impossible to skip. If any client ever queries the database directly with a user token (a BI connector, a PostgREST-style API), move the full predicate into RLS through a `SECURITY DEFINER` function that returns the subject's keys and clearances from a per-transaction context table.

**Tree moves and re-keying:** moving a unit, group, location, company, service or domain changes the ancestor keys of every record anchored below it. Small subtrees are re-keyed in the same transaction as the move; large ones by an idempotent job that selects affected rows with `acl_keys && ARRAY['ot:<moved>']`, switches each record atomically from old to new keys, bumps `acl_version` and emits outbox events. Restriction changes touch single records and are always synchronous. A nightly reconciliation recomputes keys (sample or full) and alerts on drift.

**Parity and safety tests (CI):** property-based tests generate random trees, memberships, assignments, restrictions and records and assert `SQL predicate == in-memory evaluator == key check` for every (subject, record, action); **bucket soundness** (every holder of a key may read every record that carries it) and **completeness** (every readable record carries at least one key its reader holds); plus the canary leak tests of the AI layer.

#### 7. Optional MSP domain separation

- **Off by default.** A tenant has one hidden root domain. Turning on MSP mode creates a domain tree: *root* (tenant-wide settings, provider staff) → *provider* domains → *customer* domains (→ sub-domains for a customer's subsidiaries), plus *process* domains (shared process configuration, no data) and *data* domains (shared reference data such as a common KB or catalog), following ServiceNow's domain types.
- **Data separation.** Every separated table carries `domain_id`; records inherit the domain of their company (or requester), unless a domain admin sets a managed domain. A subject's `visible_domains` = own domain and descendants ∪ explicit visibility domains (user or group) ∪ domains reached through "contains" links; all three are resolved in the subject context and enforced by the SQL predicate and the RLS domain fence. External users belong to exactly one domain. Group membership is validated so that a user can join only groups in visible domains, which keeps key buckets sound.
- **Process separation.** Configuration objects — SLA definitions, business hours, assignment rules, workflows, approval matrices, notification templates, forms and layouts, catalog items, KB bases, portal branding, AI settings — carry `domain_id`. Resolution walks from the record's domain up to the root; the nearest override wins (ServiceNow process separation, GLPI "inherit from parent entity"). Overrides are marked, diffable against the parent, and can be reset; process domains let several customers share one process without sharing data.
- **Delegated administration.** Provider admins configure customer domains; customer domain admins administer users, groups, catalog, notifications and branding of their own domain only, can grant only roles marked delegable, and can never create cross-domain visibility (that needs the tenant security admin).
- **Cross-customer work.** Provider groups live in the provider domain and see all descendant customer domains through `dt:` keys; customer-facing records assigned to provider groups stay in the customer's domain. Reports for providers group by domain; customers see only their own.
- **AI per domain.** Allowed model providers and regions, "no data to external LLMs", feature switches, knowledge sources and prompt templates resolve through the same override chain; vector partitions include the domain; record-scoped AI is pinned to the record's domain (BMC's company pinning for agentic AI).
- **Isolation guidance.** Domain separation is for MSPs and holding companies; customers who need full isolation, separate keys or separate residency get their own tenant (the same advice ServiceNow gives about separate instances).

#### 8. Offline desktop replica

- **What syncs is a scope, not a dump.** The sync service sends each device the records its user can read, as **buckets = access keys**: the subject's key set (≤ 1,000) is the subscription list, and each record is published to the buckets of its `acl_keys` (PowerSync-style parameterised buckets; or ElectricSQL shapes authorised by a proxy). Because every key is sound (all holders may read all records carrying it), one bucket's content can be shared by all its subscribers. Restrictions are folded into keys for records that carry them: a record with security level L publishes to `sl:L|<key>` buckets instead of the plain keys, a restricted-group record to `rgx:<group>` (plus the requester's `req:` key), a secure-workspace record to `ws:<workspace>|<key>`; subjects get the matching prefixed keys only when cleared. A subject's key count therefore grows with the number of clearances it holds (keys × cleared levels and workspaces), which is one more reason to keep security levels and secure workspaces few.
- **Field classes decide columns.** Rows are projected to the fields with `offline = true`; classified fields that a tenant allows offline travel in side tables published to `f:<class>|<key>` buckets, which only subjects with the field grant subscribe to. Secret, sensitive and HR/security classes never leave the server by default.
- **Working sets for broad scopes.** Subjects with tenant-wide keys (an L1 agent who may read every incident) sync a working set: assigned, member-group, participant and recently viewed records plus open records of the last N days; the rest is fetched online on demand.
- **Local enforcement is UX only.** The client runs the in-memory evaluator (same AST compiled to JavaScript) to show or hide actions offline, but the security boundary is what was synced plus the server re-check on upload.
- **Offline writes are proposals.** Mutations are queued with the base version; on reconnect the server runs the full write path (Step 5) against current state and permissions; rejections come back as conflicts with reason codes. Clients never set `acl_keys`, domain, security level, classification or audit fields.
- **Revocation.** When a subject's keys shrink (role removed, group left, record reassigned or restricted) the sync service removes the buckets and the client deletes their rows; at every connection the client receives the authoritative bucket list and purges orphans; `authz_epoch` mismatches force a resync.
- **Device security.** The local database is encrypted (e.g., SQLCipher) with a data key wrapped by the OS keystore (DPAPI on Windows, Keychain on macOS) and released after local unlock (Windows Hello/biometrics/PIN); a tenant policy sets the maximum offline period per persona (e.g., 72 hours for agents, 7 days for field technicians), after which the replica locks until online re-authentication; devices are registered; deactivation or a lost-device report revokes tokens immediately and wipes the replica on next contact.
- **Attachments.** Metadata syncs with the record; content downloads through short-lived signed URLs after a server check and is cached encrypted; a policy decides which classes may be cached.
- **Offline audit.** For classes flagged `read_audit`, the client journals local opens and uploads the signed journal on reconnect (best effort); such classes are usually excluded from offline anyway.
- **Offline AI.** Local search and any local model see only the replica, which is already authorised; no tool reaches server data while offline; online AI always goes through the server's AI layer.

#### 9. Defaults per persona

Shipped as role templates that tenants can copy and narrow. "R/W" = read/update; scopes as in section 3. Two tenant-level presets decide the agent defaults: **Open service desk** (agents read all non-restricted operational records of the tenant, as ServiceNow's `itil` does) and **Need-to-know** (agents read only member groups, assigned and participant records — the default in MSP mode).

| Persona | Identity / licence | Default record access | Content and intake | Restrictions and notes |
|---|---|---|---|---|
| Anonymous visitor | `anonymous` principal | none | public KB articles and public catalog items, only if the tenant enables them | rate-limited; no directory; never records |
| Requester (employee) | internal, no licence | create incidents/requests for self; R: `own` + `participant`; public comments on readable records; reopen/confirm own resolved records; approve when named | KB, catalog and announcements by audience | no internal notes or fields; directory limited to name and e-mail inside own company (Jira's "Browse users" lesson) |
| Line manager | requester + `reportees` | R: requests/incidents of reportees (depth 2), create on behalf of reportees, approvals for reportees | same | HR, security and restricted-group records of reportees stay hidden |
| Unit head | requester + `unit_subtree` read (opt-in) | R: service requests of the unit subtree (public fields), unit approvals | same | off by default for incidents (privacy) |
| Approver only | requester | R: records with an open approval for them (`par:` share + 30-day read-only tail) | — | approves from portal, e-mail or chat without an agent licence (JSM/Freshservice pattern) |
| External customer contact | external, no licence | create/R: `own` + `participant`; organization-shared requests if the account enables sharing | external audiences only | external fence; no internal fields; sees only contacts involved in their tickets |
| Customer admin | external | R: `company_subtree` of their account (cases, requests, assets); manage contacts | external audiences | partner relationships through dated shares (no historic cases, as in ServiceNow CSM) |
| Vendor / partner technician | external agent licence | R/W: `assigned` + vendor group; notes only when "shared with vendor" | vendor KB audience | access ends with the contract date; no directory |
| Service desk agent (L1) | agent | Open desk: R all non-restricted incidents/requests; create on behalf of any internal user; R/W/assign: `assigned` + `group`; internal and public comments; R problems, changes, known errors, CIs | contribute to own team's KB bases | no delete; restrictions apply; triage queue of unassigned records in member groups |
| Resolver agent (L2/L3) | agent | R as L1; R/W `group` + `assigned`; tasks in member groups | KB contribute | — |
| Group lead / supervisor | agent + leader membership | R/W/assign: `group_subtree` of led groups; group reports; manage membership of non-restricted groups | — | restricted-group changes need leader approval; cannot change roles |
| Observer | read-only agent | R: observer groups' records | — | no writes (Freshservice observer) |
| Problem manager | role in context | R/W problems and known errors in context; R incidents; link/merge | publish known errors to KB with audience check | known-error audience never wider than the problem's classification |
| Change manager / CAB member | role in context / CAB group | change manager: R/W/transition changes in context, schedule, approve per matrix; CAB member: R agenda changes via share, approve | — | dynamic SoD (requester, implementer ≠ approver); freeze overrides need elevation |
| Release manager | role | R/W releases; approve deployments | — | author ≠ production approver; step-up for production |
| Configuration manager | role in context | R/W CI classes in context; R all CIs | — | discovery credentials never readable through the UI |
| Asset / stockroom manager | role in location subtree | R/W assets in the location subtree; contracts without financial fields | — | financial class needs the finance grant |
| Knowledge manager / author | base owner / contributor | contribute to bases by audience; publish | — | drafts visible only to contributors and reviewers; optional author ≠ publisher |
| Service owner | role in service context | R all records linked to the service subtree; approve changes on it | — | — |
| Field technician | agent | R/W assigned work orders + their CIs/assets + customer contact (personal fields partial) | offline KB by audience | offline period up to 7 days; remote wipe |
| HR agent | agent + HR secure-workspace member + COE clearance | R/W HR cases of their COE, HR fields | HR KB | IT roles and tenant admins see nothing; impersonation blocked |
| Security analyst | agent + security clearance | R/W security incidents and vulnerabilities | — | read audit on; excluded from offline |
| Finance / budget owner | role in cost-center subtree | R financial fields and aggregates of the subtree | — | aggregate-first |
| Executive / analytics viewer | role | `report_aggregate` over the tenant (dashboards with small-cell suppression), no row read | — | drill-down only into records they could read anyway |
| Tenant admin | admin licence | configuration of forms, workflows, SLAs, catalog, notifications, roles below "elevated"; data only through any agent role they also hold | — | cannot pass restrictions; cannot grant elevated roles or clearances |
| Security admin | elevated, just-in-time | manage roles, grants, restrictions, field policies, SSO/SCIM, audiences | — | step-up MFA, time-boxed, reason; SoD with auditor; no data read |
| Auditor | read-only | R audit logs, policy versions, access reviews, non-restricted records | — | SoD with admin roles |
| MSP provider admin | domain admin at provider level | configure customer domains, overrides, domain picker | — | cannot create cross-customer visibility |
| Customer domain admin | delegated admin | users, groups, catalog, notifications and branding of own domain | — | bounded by own domain and delegable roles |
| Integration | integration principal | explicit grants per resource, action and field; no UI login | — | OAuth client credentials or mTLS, IP allowlist, short token TTL, named owner, quarterly certification |
| AI assistant (on behalf of a user) | the user ∩ agent tool allowlist ∩ AI-channel policy | as the user, never more | as the user | see section 12 |
| Autonomous AI agent | `ai_agent` principal | explicit minimal grants (e.g., read a queue, write category and assignment fields, add internal notes) | its knowledge sources by audience | high-risk actions need approval; kill switch; actions attributed to the agent and the triggering human |
| Platform support (vendor staff) | `support_grant` | none by default | — | customer-approved, time-boxed, visible in the tenant audit log |

#### 10. Delegation, elevation, impersonation and break-glass

- **Work delegation** (approvals, assignments, notifications; conditions such as "only changes of type Standard"; validity period; "exclude confidential notifications") is separate from **access delegation**. Like ServiceNow granular delegation, work delegation grants no standing record access: the delegate receives `par:` shares only on the records under delegated approval or assignment, for the delegation period.
- **Access delegation** (an executive assistant reading the manager's requests) is an explicit `record_access` delegation, bounded by the delegator's own scope, excluding restricted classes, visible to the delegator, time-boxed and audited.
- **Out of office**: calendar or HR absence creates time-boxed delegations automatically and removes the agent from routing; Freshservice's one-active-delegate rule is a sensible default.
- **Just-in-time elevation**: elevated roles (security admin, data export, bulk delete, freeze override) are requested with a reason, optionally approved, require step-up MFA, expire automatically and are written to the privileged-action log (ServiceNow's elevate-in-session pattern).
- **"View as" (impersonation)** is read-only by default, shows a banner, cannot see secure workspaces, restricted groups or HR/security data (ServiceNow HR property, Freshservice restricted-group block), and is logged; write impersonation is a separate elevated permission with a reason.
- **Break-glass**: at least two tenant-level emergency accounts that do not depend on the tenant's IdP (local passkeys), sealed credentials, alert on every use, auto-expiring sessions, a mandatory post-use review and periodic drills (Microsoft Entra guidance); vendor support access only through a customer-approved `support_grant`.
- **Degraded mode**: if the IdP is down during a major incident, existing sessions may be extended within a bounded, logged policy rather than logging everyone out.

#### 11. Identity lifecycle and authentication

- **SSO** with OIDC (authorization code + PKCE) and SAML 2.0 per tenant (several IdPs per tenant for internal and external users); **MFA** with passkeys/WebAuthn and TOTP; **step-up** per action class following NIST SP 800-63B-4 reauthentication windows (AAL2 for agents: session ≤ 24 h, inactivity ≤ 1 h; AAL3-style recency for security admin actions); idle and absolute timeouts per persona; session listing and revocation; IP allowlists; sessions and tokens revoked on role change or deactivation.
- **SCIM 2.0** (Users, Groups, enterprise extension: employeeNumber, costCenter, organization, division, department, manager) drives joiner–mover–leaver: joiner creates the user with anchors and persona; mover recomputes contexts and bumps `authz_epoch` (re-keys live anchors only); leaver deactivates, revokes sessions and tokens, wipes devices, reassigns open work and transfers owned reports and dashboards.
- **Assignment rules** (GLPI authorization rules): IdP attributes or groups → role assignments in context (e.g., `department = Finance` → requester role + finance audience; IdP group `IT-EMEA-L2` → agent role in group context `EMEA-L2`), each assignment carrying `source = hr_rule` so it is removed when the rule stops matching.
- **External identities**: separate auth policies, customer SSO per account, magic-link or OTP sign-in, e-mail domain rules, self sign-up on or off per portal (JSM customer access types).
- **Non-human identities**: one principal per integration (client credentials or mTLS, short TTLs, IP allowlist, endpoint/table/field allowlists, named owner, quarterly certification, a machine-identity score in the style of ServiceNow's Machine Identity Console — unused for 90 days, basic auth, UI+API logins); user-scoped API tokens inherit the user's permissions and expire; OAuth token exchange (RFC 8693) for integrations that act for a user.

#### 12. How the AI layer must enforce it

1. **Two identity modes, no third.** *Assist* runs as the user: `allowed(action, record) = user_can(action, record) AND agent_tools_allow(action) AND ai_channel_allows(record)`. *Autonomous* agents are `ai_agent` principals with explicit minimal grants; their actions are attributed to the agent and to the human who triggered or approved them (ServiceNow dynamic user vs AI user; Rovo user's account vs agent's account). There is no shared "AI service account" with broad rights.
2. **Permission-aware retrieval with both bindings.** Chunks live next to their records (`chunk(tenant_id, domain_id, record_type, record_id, field_group, acl_keys, classification, version, embedding)`). Retrieval runs vector and keyword search *with* the subject's compiled predicate in the WHERE (early binding), over-fetches (e.g., 3× N), then re-checks the top hits with the record-level evaluator (late binding) before anything reaches the prompt; counts are never shown from the pre-filter. Field groups the subject cannot read (internal notes, HR, financial, secret) are never retrieved.
3. **Context pinning.** Record-scoped skills (summarize, suggest resolution, similar incidents) pull related records only if the subject can read them and, in MSP mode, only within the record's domain — even if the user can see several domains (BMC's company pinning). Persona pinning: the requester-facing assistant uses the requester persona even when the same person is also an agent elsewhere.
4. **AI-channel policy stricter than access.** A per tenant/domain/resource/classification flag decides whether content may be used by AI at all (Atlassian MCP control, Microsoft Restricted Content Discovery) and whether it may be *extracted* into answers or only linked (Microsoft EXTRACT right). Defaults: secret and sensitive never; HR and security only in their own partitions and assistants.
5. **Tools are ordinary API operations.** Every tool declares `required_permission`, `risk` (read / write / destructive / external) and `policy` (auto / confirm / approval / blocked) — Freshservice's action policies; new or unmapped tools default to blocked; tools run with the user's session or an on-behalf-of token, through the same authorization layer as the UI (ServiceNow downstream ACL conjunction: the user must pass every tool the agent holds).
6. **Writes are proposals.** The model returns a structured change (target, field diff or action, reason, sources); confirmation executes the normal write path (Step 5: grants, field rules, transitions, option rules, SoD, audit). High-risk actions (closing a P1, approving a change, granting a role, bulk updates, external messages) need explicit approval, possibly from someone other than the requester.
7. **Citations are re-authorised at render time**, cached answers are keyed by `(tenant, ACL fingerprint, normalised query, source versions)`, and semantic caches are never shared across subjects unless every source is public; no "3 hidden sources" hints.
8. **Aggregates and smart reports** compile to the report engine under the viewer's predicate with small-cell suppression; the model receives aggregates, not raw rows, for statistical questions; AI-generated charts are saved as report definitions, not data snapshots.
9. **Prompt-injection containment.** Retrieved records, e-mails, attachments and tool output are data in labelled blocks; they can never change identity, tool allowlist or policy. Skills use the constrained patterns where possible (action-selector for routing and triage, plan-then-execute for runbooks, a quarantined reader without tools for e-mails and attachments, context-minimisation). Output is sanitised (no auto-loaded images or links to unknown hosts); outbound tools are host-allowlisted; an injection classifier runs in log mode first, then block mode (Guardian, Prompt Shields).
10. **Data minimisation.** Mask personal data with reversible placeholders before external models (Data Privacy for Now Assist pattern); per tenant/domain allowlists of model providers and regions; a local-model option for "no data leaves the network"; no training on tenant data; retention settings for prompts and outputs.
11. **Our own MCP server** follows the MCP authorization spec (OAuth 2.1, audience-bound tokens, no token passthrough), issues per-user revocable tokens that inherit the user's permissions (InvGate), starts read-only (TOPdesk), and honours the AI-channel policy for every call.
12. **Freshness is security.** ACL anchor changes re-key chunks in the same transaction (outbox) or mark them stale and excluded until re-keyed; connector content mirrors source ACLs with a stated freshness window and fails closed when sync is late; a nightly job reconciles chunk keys with record keys.
13. **Studio and logs are governed records.** Who may build agents, who may invoke them (invocation grants, deny-by-default for new agents and tools), and who may read AI conversation logs are separate permissions; conversation logs inherit the access of the user and records involved (fixing Freshservice's workspace-wide log visibility).
14. **Observability and kill switches.** `ai_run` stores identity, on-behalf-of, retrieved record IDs, tool calls with arguments and results, approvals, model and version, tokens and cost; anomaly alerts fire on unusual record volumes or repeated denials; switches disable an agent, a tool, a provider or all AI per tenant or domain (AI Control Tower pattern).
15. **Leak tests in CI.** Canary records (restricted group, HR case, other tenant, other domain, secret field) carry unique marker strings; evaluation suites ask every assistant and agent, under many personas, to reveal them through search, chat, summaries, reports, exports and tools; any marker in an output fails the build.
16. **Offline AI** sees only the device replica, which is already authorised.

#### 13. Assurance and admin tooling

- **Explain / view as / compare / who can see** for any record, user pair or role (section 6), with the AI explainer narrating the deterministic trace (it never decides).
- **Policy simulator**: every change to roles, grants, restrictions, audiences or field policies shows who gains and who loses access (counts and samples) on live data before publishing; publishing needs step-up MFA; versions are kept and can be rolled back; sandbox-to-production promotion carries the same diff.
- **Access reviews**: campaigns per role, group, restricted group, clearance and integration; reviewers see last use, peers' access and SoD conflicts; revocations apply automatically; unused grants (90 days) are proposed for removal.
- **Access-risk analytics**: sudden scope growth, dormant privileged accounts, external users with internal roles, SoD conflicts, integrations with basic auth, AI agents with write tools and no approvals; a hardening score per tenant (ServiceNow Security Center pattern).
- **Logs**: privileged-action log (elevation, impersonation, break-glass, policy changes, bulk export, mass reads, AI tool calls) append-only and hash-chained, streamed to SIEM; read audit for sensitive classes; denial logs for investigations.

#### 14. Build order

1. **Foundation**: tenant isolation with RLS backstop; principals, groups (member/observer/leader), org trees with closure tables; roles with containment; grants with scopes `own, assigned, participant, group, group_subtree, unit_subtree, company_subtree, all`; acl_keys trigger; the compiler with SQL and in-memory forms; parity tests; explain and view-as; SSO, MFA, SCIM.
2. **Confidentiality**: restricted groups, security levels, secure workspaces, classification, external fence; field classes with masks and query-operator checks; audiences for KB, catalog and request types; dynamic SoD in approvals; work delegation; JIT elevation; privileged-action log.
3. **AI layer v1**: assist-as-user with permission-aware retrieval (early + late binding), field-group chunks, proposals for writes, citation re-check, injection containment, leak tests.
4. **Offline replica**: key buckets with restriction folding, field-class side tables, working sets, encrypted local store, device registry, revocation and wipe.
5. **MSP domain separation**: domain tree, domain fence in RLS, process overrides, delegated domain admins, per-domain AI policy.
6. **Advanced**: autonomous AI agents with own identities, our MCP server, access reviews and risk analytics, relationship tuples for partner/contact relationships, policy export to Cedar for external audit.

## AI capabilities

Every AI, ML, generative and agentic capability found in this research that touches identity, permissions or data visibility, with how it works. Items marked *(recommended)* are not vendor features but capabilities our product should add on top of the access model.

**ServiceNow**

- **AI user identity** — a `sys_user` with identity type "AI user" and preset roles; autonomous agents run as it for consistent, auditable privileges.
- **AI invocation ACLs** — Allow-If role rules on AI agents, agentic workflows, generative AI skills, flows and flow actions ("Any authenticated user", "Users with specified roles", "Public"); Deny-Unless rules can be added in the ACL table.
- **Dynamic-user run-as** — the agent executes with the identity of the invoking user (or the triggering record/agent), so its rights follow the caller.
- **Role filtering (role masking)** — the agent's effective roles = the caller's roles ∩ a builder-approved subset.
- **Downstream ACL conjunction** — the user (or AI user) must pass the ACLs of every component of the agent, used or not; conflicting requirements make execution fail closed.
- **Deny-by-default for agentic resources** — on new Australia/Brazil instances a wildcard ACL with security attribute "Never" denies any agent, workflow, skill, flow or action that has no explicit ACL; Studio shows warning banners.
- **Now Assist Guardian: prompt-injection detection** — a classifier trained on role-play, paraphrasing and "ignore previous instructions" attacks screens prompts of all generative AI features; log or block with sensitivity thresholds.
- **Now Assist Guardian: offensiveness detection** — scores outputs of supported skills for toxic, defamatory or fraudulent content; log or block.
- **Now Assist Guardian: sensitive-topic filters** — Virtual Agent conversations about sensitive HR topics are redirected to a fallback topic instead of an AI answer (requires HRSD).
- **Data Privacy for Now Assist** — regex/data-pattern rules replace sensitive values with placeholders before inference and restore them in the response; logged in the generative-AI log.
- **AI Search early binding** — the user's non-scripted ACLs, before-query rules, domain separation and user criteria are compiled into the search query.
- **AI Search late binding** — each hit is checked with `canRead()`; used for scripted ACLs, on errors, or when forced per source or globally.
- **External content permissions in AI Search** — source-system ACLs are kept at ingestion and matched to ServiceNow users through aliases.
- **Genius Results / Now Assist Q&A** — a generated answer card appears only when a highly relevant article the user can access exists.
- **"Investigate and resolve" agent run as the assignee** — the trigger must use *Run as: Assigned to*, so the agent works with the accountable agent's rights.
- **Context-menu skill ACLs** — built-in skills such as shorten/elaborate/tone can be restricted with an ACL checking authentication (Yokohama Patch 6).
- **Simplified ITSM configuration agents** — AI agents configure SSO, groups and roles, imports, routing, SLAs and change models during implementation.
- **AI Control Tower** — inventories AI assets (including non-human identities), observes agent runtime (Traceloop), governs risk (NIST/EU AI Act frameworks), secures with the Veza access graph and least privilege, measures cost/ROI; shuts down agents acting beyond their permissions.
- **Veza access graph** — computes effective permissions across human, machine and AI identities to find over-privileged agents.
- **AI Gateway for MCP** — applies real-time controls to MCP transactions and tracks MCP servers as governed assets.
- **ServiceNow Otto** — the unified assistant (Now Assist + Moveworks + AI Experience) announced 2026-05-05; inherits the controls above (permission specifics of Otto not verified).

**Moveworks (ServiceNow)**

- **Mirrored permissions** — source READ/WRITE grants and group/role memberships are flattened into content→operation→user tuples in OpenFGA (ServiceNow user criteria mirrored into Redis) and used as a retrieval pre-filter.
- **Managed permissions** — an ABAC rule language over user attributes (division, department, country) and content attributes (KB, space, site, URL), applied as a query-time post-filter.
- **User-consent live search** — the source API is queried at question time with the user's own OAuth token.
- **Permission refresh** — events/webhooks or roughly 15-minute checks of content, permission, group/role and user changes.
- **Permissions Checker and Data Ingestion View** — admin tools showing which content a given user can reach and what was ingested.

**Atlassian (JSM, Rovo)**

- **Rovo acting as the user** — agents use the invoking user's permissions and cannot read or act on what that user cannot.
- **Rovo agent's account** — an agent identity with three access layers (organization defaults, app access, user-granted access); actions credited to the agent; recommended for automations.
- **Default access for future agents** — org admins pre-set app and group access; new agent accounts get the app's user role automatically.
- **Rovo Studio governance** — who may create agents (all / selected groups / none) and who may use each agent (open or named users).
- **Teamwork Graph connector permission sync** — third-party content keeps source permissions, synced within a freshness window; stale permissions are treated conservatively.
- **MCP access control in data security policies** — blocks AI agents from reading covered content through the Atlassian MCP server per organization, site, object or classification, even when the user could view it; OAuth only.
- **Rovo Chat security** (announced at Team '26) — blocking or redacting sensitive data in prompts and responses.
- **Units and IP allowlists for AI** — Enterprise units confine Rovo to the unit; IP allowlists also cover Rovo experiences and the Rovo MCP server.
- **Ops Expert with viewer permissions** — linked resources are resolved with the viewing user's permissions, so results differ per viewer.
- **Request Resolver supervised/autonomous modes** — plans are reviewed by humans until a request type is promoted to autonomous; help seekers see only what they may see or what an agent approved.
- **Channel-aware request-type restrictions** — restricted request types are removed from e-mail, chat, widget and virtual-agent channels where the audience cannot be evaluated.

**Freshservice (Freddy AI)**

- **Copilot per role and licence** — admins choose Copilot capabilities and Freddy Insights per agent role; each agent consumes a Copilot licence.
- **Copilot Agent action policies** — the agent's permissions are checked before recommending and before executing; each action is Always allowed / Approval required / Blocked and limited to groups; new actions arrive unmapped.
- **AI Agent Studio permission** — *Manage AI Agent Studio* on a role gates agent building; it also exposes all AI conversation logs of the workspace (logs not covered by RBAC).
- **Freddy AI Agent with enterprise search** — answers requesters in Slack, Teams, e-mail and the portal from KB, SharePoint, Google Drive and Confluence with citations; connector permission handling not documented.
- **Knowledge-source filtering per AI agent** — admins pick which knowledge sources each AI agent or request type may use.

**BMC Helix**

- **HelixGPT permission check before context** — chunks of documents the user cannot view (per ITSM/Helix Portal permissions) are never sent to the LLM.
- **Tenant-separated vector store** — OpenSearch with tenant-specific RBAC and index-level (1-series) or logical (26.2) separation; no cross-tenant search.
- **Dynamic tags** — knowledge filtered by role, permission and location tags.
- **HelixGPT Admin and Agent Studio roles** — separate rights for prompt administration and for building skills/agents.
- **Agentic AI pinned to the ticket's company** — in multitenant setups agentic AI retrieves only data of the ticket's customer company (plus global data), even for users with access to several companies.

**ManageEngine ServiceDesk Plus**

- **Zia Agent roles** — Zia Agents are MCP-based assistants, each bound to a system-defined, non-editable role that limits its permissions.
- **ZiaVerifier role** — named humans verify Zia predictions before they are trusted.

**Other ITSM vendors**

- **Halo AI Agents with an Application identity** — runbook AI steps authorize as a chosen Halo Application that defines identity and permissions, using the same functions as Halo's MCP server.
- **Halo AI provenance flags** — AI-created tickets, actions and KB articles record the creating Virtual Agent, AI Agent or MCP tool collection.
- **InvGate MCP server and Agent Studio** — nine read-only MCP tools with per-user revocable tokens that inherit the user's permissions; agent actions set to auto, confirm or never.
- **TOPdesk MCP and AI settings** — a read-only MCP server scoped to the customer's data; all AI off by default, AI output labelled.
- **Xurrent MCP server** — external agents inherit the "Shared Policy and Data Layer" and the same audit as native agents.
- **SysAid "AI Admin" permission** — all Copilot configuration requires a dedicated permission.
- **Alemba AI governance console** — per-capability on/off switches and a log of every AI action.
- **Zendesk employee-service AI agents** — handle access approvals and onboarding by acting in identity and workflow systems (permission model not verified).

**AI platforms outside ITSM (reference)**

- **Glean permission-filtered context pool** — indexed and live (per-user) retrieval merged and filtered by synced source permissions; the source enforces again at click time; admins decide which tools run automatically or with approval.
- **Microsoft 365 Copilot permission trimming and EXTRACT** — only content the user can view is used; encrypted content also needs the EXTRACT right, otherwise Copilot links instead of summarizing.
- **Microsoft Restricted Content Discovery** — selected SharePoint sites are excluded from Copilot and org-wide search without changing user access.
- **Salesforce Einstein Trust Layer** — permission-scoped retrieval, dynamic grounding, masking, zero data retention at the provider, toxicity scoring and audit.
- **Azure AI Content Safety Prompt Shields** — a classifier for direct and indirect prompt injection (recommended by BMC).
- **Atlassian Guard detections** — alerts on anomalous user activity, data exfiltration and access events (ML use not verified).

**Frameworks applied to AI permissions**

- **OWASP Top 10 for LLM Applications 2025** — the audit checklist: prompt injection, sensitive information disclosure, excessive agency, system prompt leakage, vector/embedding weaknesses (cross-tenant RAG leakage).
- **MCP authorization** — OAuth 2.1 with audience-bound tokens (resource indicators) and no token passthrough, preventing confused-deputy attacks.
- **Prompt-injection design patterns** — action-selector, plan-then-execute, LLM map-reduce, dual LLM, code-then-execute (CaMeL), context-minimization.

**Recommended for our product (built on the access model)**

- **Permission-aware RAG** *(recommended)* — vector and keyword search with the subject's compiled predicate (access keys) in the query, then an exact record-level re-check of top hits before prompting.
- **Field-group chunking** *(recommended)* — chunks per field group carry their own keys, so internal notes, HR and financial text are never retrieved for subjects without the field grant.
- **AI-channel policy** *(recommended)* — per tenant/domain/resource/classification switches for "AI may read" and "AI may extract", stricter than record access.
- **Proposal-based AI writes** *(recommended)* — models return structured changes that execute only through the normal write path after confirmation or approval.
- **Citation re-authorisation and ACL-fingerprint caching** *(recommended)* — each cited record is re-checked at render time; caches are keyed by the subject's ACL fingerprint.
- **Access explainer** *(recommended)* — answers "why can't I see INC-123?" by narrating the deterministic `explain` trace; it never decides access.
- **Policy authoring copilot** *(recommended)* — turns an admin's description into draft roles, grants, restrictions or audiences, which must pass the who-gains/who-loses simulator and approval.
- **AI-assisted access reviews** *(recommended)* — summarises each assignment's last use, peer comparison and SoD conflicts, and proposes revocations for the reviewer to decide.
- **Role mining** *(recommended)* — clusters actual permission usage to propose leaner roles and highlight toxic combinations.
- **Anomalous-access detection** *(recommended)* — models per user, integration and AI agent flag unusual record volumes, scope jumps, off-hours bulk reads and repeated denials.
- **Sensitive-data classifier** *(recommended)* — detects credentials, personal and HR data in descriptions, comments and attachments, then masks the field and proposes a classification or restriction.
- **Access-request agent** *(recommended)* — a conversational agent collects role/access requests, routes them through the authority matrix with SoD checks, and provisions through SCIM or IGA connectors after approval.
- **Leak-test generator** *(recommended)* — generates adversarial questions against canary records for each persona and runs them in CI.
- **Quarantined reader for untrusted text** *(recommended)* — a tool-less model summarises e-mails and attachments; only its summary reaches the tool-using model.

## Differentiators

What each tool or framework does better than the others, followed by where the recommended model goes beyond all of them.

**Per tool**

- **ServiceNow** — the most expressive rule engine (Allow-If and Deny-Unless ACLs per table, field and operation, with roles, security attributes, conditions and scripts); pre-query Security Data Filters; query ACLs that stop inference through range filters and sorting; full **domain separation** with data, process and UI separation and override inheritance; user criteria with deny-wins; granular delegation; Access Analyzer and Security Center; the deepest AI permission model (invocation ACLs, run-as dynamic user vs AI user, role masking, downstream ACL conjunction, deny-by-default for agents, Guardian, AI Control Tower with Veza).
- **Jira Service Management** — reusable permission and security schemes shared by many spaces; *security types* as dynamic principals (reporter, assignee, custom-field users, portal access); a clean separate customer identity class (portal-only accounts, organizations, sharing settings, customer SSO); data security policies that can block AI/MCP access per classification; Rovo agent identities with layered access.
- **Freshservice** — a scope attached to *each privilege*, which admins understand; observer membership; restricted groups with leader approval and blocked impersonation; restricted workspaces that exclude even account admins; per-action AI policies (Always allowed / Approval required / Blocked) with permission checks before recommending.
- **BMC Helix ITSM** — row-level security enforced by the data layer from a denormalised principal field (field 112) written at submit time, so lists, reports and APIs cannot leak; company-based multi-tenancy with selectable data access models; agentic AI pinned to the ticket's company.
- **ManageEngine ServiceDesk Plus** — sites that are both a visibility scope and a configuration unit (hours, holidays, SLAs, business rules); very granular request permissions (resolve, close, merge, edit due time, delete others' notes); MCP-based AI agents bound to fixed roles.
- **TOPdesk** — the simplest mental model (permission groups plus filters) that also applies to API users; AI off by default with a read-only, customer-scoped MCP server.
- **GLPI** — the entity tree with *recursive* profile assignments and dynamic assignment rules from LDAP/mail/inventory, plus configuration inheritance down the tree; per-profile lifecycle matrices.
- **iTop** — the silo filter injected into every query by the data model, transition rights (stimuli) as first-class permissions, and delegated admins who cannot grant organizations outside their own.
- **Znuny / OTRS** — option-level ACLs that restrict selectable values and actions by context, beyond record visibility.
- **HaloITSM** — client and ticket-type restrictions for co-managed IT; AI agents that run under an explicit Application identity with provenance flags on everything they create.
- **Ivanti Neurons for ITSM** — data segregation expressed through people hierarchies (org unit, team, geography, cost center) linked to the Employee object.
- **Dataverse and Salesforce (reference)** — the depth ladder (user, unit, unit subtree, organization) and the clean split between widening sharing rules and narrowing restriction rules.
- **Zanzibar family (OpenFGA, SpiceDB)** — reverse queries (who can see / what can I see), consistency tokens and materialised permission sets for downstream systems.
- **Moveworks, Glean, Microsoft 365 Copilot** — the most mature permission-aware retrieval: mirrored + managed permissions, live per-user retrieval, permission trimming, AI-specific extract rights and AI-only exclusions.

**Where the recommended model goes further**

- **One policy, three compiled forms** (SQL predicate, access keys, in-memory evaluator) with property-based parity tests, so lists, counts, search, vectors, sync, notifications and AI cannot drift apart.
- **Access keys double as offline sync buckets**, with restrictions and field classes folded into the keys, so the desktop replica holds exactly what the user may read — no vendor studied offers a permission-exact offline replica for ITSM.
- **Capability × scope × context with recursion** in one closed scope list, covering Freshservice scopes, Dataverse depth, GLPI recursion, Clarity OBS modes and ServiceNow domain trees without cloned roles.
- **Restrictions that outrank grants and admins** (security levels, restricted groups on every record type, secure workspaces, classification, external fence), labelled as restrictions in the UI and previewed by a who-gains/who-loses simulator.
- **Explicit hand-off grace** instead of hidden "last changer" rules or lost tickets after reassignment.
- **Field classes enforced everywhere** — projection, filters and sorts (inference control), history, notifications, exports, search, vectors, offline and AI — with hash-match lookups for sensitive identifiers.
- **Aggregate-only grants** for executives and finance (dashboards with small-cell suppression, no row access).
- **Optional MSP domain layer** inside a tenant with process overrides, delegated domain admins and per-domain AI policy, while full isolation remains a separate tenant.
- **AI that can never exceed its user**: `user ∩ agent tools ∩ AI-channel policy`, early + late binding, context and persona pinning, proposal-only writes, citation re-check, governed conversation logs, kill switches and canary leak tests in CI.
- **Built-in explainability and assurance** from the first release: explain, view-as, compare, who-can-see, access reviews, risk analytics and a hash-chained privileged-action log.
