# AI in ITSM — complete capability catalog across vendors, with implementation recipes

> Research date: 2026-11-07. Scope: every AI / ML / generative / agentic capability found in ITSM and ESM suites and in adjacent AIOps platforms, plus a build recipe for each one. The recipes assume a new enterprise ITSM product with bring-your-own models (OpenAI-compatible, Anthropic, Gemini, or local Ollama/vLLM) and permission-aware AI. Anything not confirmed against a source in this pass is marked "(unverified)". Vendor numbers (deflection %, time saved) are reported as vendor claims, not facts.

## Overview

### Where the market stands (late 2026)

AI in ITSM now comes in five layers. Every serious vendor ships the first three, and the leaders compete on the last two.

1. **Predictive / classical ML (since about 2018).** Classification (category, assignment group, priority), similarity (similar incidents and articles), clustering (problem candidates, major incident candidates, knowledge gaps), and regression and forecasting. Examples:
   - ServiceNow Predictive Intelligence, with Classification, Similarity, Clustering and Regression frameworks, later extended by Task Intelligence.
   - ManageEngine Zia predictions, trained locally on each customer's own data.
   - Ivanti ticket classification.
   - SysAid Intelligent Categorization.
   - InvGate category and priority suggestion.
2. **Generative assistance (2023–2024 wave).** Record summaries, resolution notes, reply drafts, writing and tone tools, translation, KB article generation, PIR/MIR drafts, change summaries and risk narratives. These are now table stakes.
3. **Conversational self-service.** LLM virtual agents answer from retrieved content with citations (RAG), across portal, Teams, Slack, email, WhatsApp, Microsoft 365 Copilot and voice. They also capture requests without forms and search external sources (SharePoint, Confluence, Google Drive).
4. **Agentic (2025–2026).** Agents with tools take actions rather than suggest them: triage-and-update, investigate-and-resolve, provision access, run remediation, generate onboarding journeys.
   - **2025:** builders and orchestrators arrive (ServiceNow AI Agent Studio and Orchestrator, January 2025; BMC HelixGPT Agent Builder; Freshservice AI Agent Studio; Zia Agent Studio).
   - **2026:** the framing shifts to AI that owns a whole role. Examples are ServiceNow's L1 IT Service Desk AI Specialist (GA), Atlassian Request Resolver (formerly Rovo Service), BMC Ticket Resolver, ManageEngine's L1 ServiceDesk Specialist agent, Atomicwork "AI Coworkers" and Xurrent's autonomous agents.
   - **Headless ITSM via MCP (2026):** ITSM workflows are exposed through MCP servers so outside agents (Claude, ChatGPT, Copilot, Cursor) can act under the ITSM's own policies. Examples are ServiceNow Action Fabric, Xurrent's open MCP server, TOPdesk MCP, Zoho MCP, Atlassian MCP and Atomicwork's "headless ITSM".
5. **Governance and economics as product features (2025–2026).** The building blocks:
   - AI control towers that cover inventory (including shadow AI), risk frameworks (NIST AI RMF, EU AI Act), agent identity and permissions, runtime observability, cost and ROI, and a kill switch.
   - Prompt-injection blocking on by default.
   - PII masking.
   - Evaluation harnesses with LLM judges and synthetic data.
   - Visible metering: Atlassian Rovo credits, Freshservice AI Agent sessions, Zendesk outcome-based resolution allowances, ManageEngine token dashboards.

   The counter-trend is to include AI at no extra charge (Xurrent, TOPdesk, InvGate, ManageEngine native AI, and Halo, whose runbook agents are in base licensing).

### Vendor snapshot (November 2026)

| Vendor | AI products / brands | Latest release markers | Packaging & metering | Notable 2025–2026 moves |
|---|---|---|---|---|
| **ServiceNow** | ServiceNow **Otto** (announced 2026-05-05; unifies Now Assist, Moveworks and "AI Experience"), Now Assist skills, AI Agents, AI Agent Studio, AI Agent Orchestrator, Autonomous Workforce "AI Specialists", Predictive Intelligence, AI Search (RAG), AI Control Tower, Action Fabric (MCP server), AI Agent Fabric (MCP and A2A), Now Assist Skill Kit and Data Kit, Now Assist Guardian, EmployeeWorks, Moveworks | Families: Yokohama (2025), Zurich (late 2025), Australia (2026), Brazil (EA 2026-09-24, GA Q4 2026 per a third-party blog). AI apps ship continuously as store "Now Assist Suite" releases (e.g. 2026-06-11, 06-16, 07-09, 07-16). | AI SKUs. Historic "Pro Plus" with "assists" metering (unverified current). Australia introduced Foundation / Advanced / Prime AI tiers (third-party source, unverified). MCP Server included in every Now Assist and AI Native SKU. A 2026 headline says "ServiceNow ends the AI add-on" (details unverified). | Moveworks acquisition closed 2025-12-15 (about $2.85B per press coverage). Knowledge 2026: Otto, Action Fabric, about 20 new AI specialists, Project Arc (autonomous desktop agent with NVIDIA, sandboxed in OpenShell), and an AI Control Tower overhaul (Innovation Lab May 2026, GA August 2026) adding Traceloop observability, Veza access graph and Armis asset context. |
| **Atlassian** (JSM / Service Collection) | Rovo (Search, Chat, Agents, Studio), **Request Resolver** (formerly Rovo Service), **Ops Expert** (formerly Rovo Ops), virtual service agent, Teamwork Graph, Atlassian MCP, Prevention Center (EAP) | Cloud, continuous. Team '26 announcements. | Rovo on by default in Standard, Premium and Enterprise. Virtual service agent and Ops Expert change-risk need Premium or Enterprise. Request Resolver resolution management is in all Cloud editions. Rovo credits: 100 per resolution plan, allowances enforced from 2026-12-03, admin limits, notifications at 80% and 100%, optional overage billing. | Named a Leader in the 2026 Gartner MQ for ITSM Platforms (per Atlassian). Service-based AI routing on the roadmap for Q4 2026. |
| **Freshworks Freshservice** | Freddy AI Agent, Freddy AI Copilot, Freddy AI Insights, AI Agent Studio, Copilot Actions | Continuous. Legacy virtual agent deprecated 2025-05-21. | Copilot is an add-on for Pro, Enterprise and Freshservice for Business Teams. AI Agent requires Enterprise: 1,200 sessions per license per year, where a session is one unique user in 24 hours. Insights: Enterprise. | Precision (skill-based) routing in Early Access. |
| **BMC Helix ITSM** | HelixGPT. Agents: Service Collaborator, Ops Swarmer, Knowledge Curator, Problem Solver, Ticket Resolver. No-code HelixGPT Agent Builder, MCP support. | 26.1 (MIR generation, incident summary, Ops Swarmer timeline); 26.2 / 26.2.01 (Ticket Resolver, Problem Solver) | (unverified) | Major-incident collaboration through Microsoft Teams (Ops Swarmer). |
| **Ivanti Neurons for ITSM** | "Ivanti ITSM AI" / Neurons AI; Agentic AI (multi-agent self-service) | 2026.1 | Agentic AI is an add-on license, SaaS only, needs SQL Server 2025+. GenAI features are SaaS only from 2024.2. AI also comes with "Neurons AI for ITSM" or the Premium / Enterprise Premium packages. | Self-service agent released on a controlled basis in April 2026. |
| **ManageEngine ServiceDesk Plus** | Zia: Ask Zia, Zia Agents (Agent Store, Agent Studio, multi-agent), Zia LLM, Zoho MCP | H1-2026 releases | Native AI in all three editions (vendor claim). Zia Agents: cloud Enterprise. Ask Zia in Standard and Professional when powered by Zia LLM. | Per-capability model choice: Zia LLM, ChatGPT, Azure OpenAI or Google AI Studio (BYOK). |
| **SysAid** | SysAid Copilot (Agent Assist, AI Chatbot, AI Emailbot, Intelligent Categorization), 40+ prebuilt AI agents (March 2025) | Docs dated August 2026 | "AI Admin" permission governs AI configuration | Agentic layer resolves routine tickets under admin-defined governance (third-party description). |
| **HaloITSM** | Halo AI, AI Agents, Platform Intelligence, Ability Library, Agent Interoperability | 2026R2 | Runbook-based AI agents in base licensing (third-party review) | "Connect any external agent, control every permission." |
| **Xurrent** (formerly 4me) | Sera AI (Investigate, Scribe, Ask, Recap, Brief, Sera AI Assist), autonomous agents, open MCP server, iPaaS | May 2026 (agents and MCP); August 2026 (ITSM agent audit log, Sera guardrail reviews, iPaaS Connector SDK); 2026-10-15 (AI SRE teammate) | AI included in every tier at no extra charge | Recognized in the 2026 Gartner ITSM MQ. Vendor claims 91% of customers run Sera in production. |
| **Zendesk** | Resolution Platform: AI agents (including standalone Forethought-powered agents), Copilot, Intelligent Triage, QA, WFM | 2026 ("Autonomous Service Workforce") | AI agents included in Suite and Support with a resolution allowance (outcome-based). Copilot add-on for Professional and above. | 80 languages; procedures written in natural language. |
| **InvGate** | AI Hub: Virtual Service Agent, AI-Improved Responses, Request Escalation, Major Incident Detection, and more | — | Included in all Service Management and Asset Management plans, cloud and on-prem. On-prem still calls cloud-hosted models. | AI adoption reports comparing with-AI and without-AI. |
| **TOPdesk** | AI Categorization, Summarization, Knowledge Item Creation, Writing Assistant, AI Search, Answer Assistant, Translation, AI Readiness Dashboard, AI Triage, **TOPdesk Robin**, MCP | GA between 2026-03-31 and October 2026 | Included in the subscription, gated by plan (Engaged / Excellent). Every AI feature is off by default. | Data stays in region. No training on customer data. AI output is labelled. MCP is read-only. |
| **Moveworks** (ServiceNow) | Reasoning Engine, AI Assistant, enterprise search, Agent Studio / Tool Studio, AI Agent Marketplace | Continues as a standalone product | — | Folded into Otto and EmployeeWorks (EmployeeWorks launched 2026-02-26). |
| **Aisera** | AiseraGPT, AI Copilot, AI Search, AiseraLLMs and LLM Studio, Agent Library, Prompt Studio, Hyperflow Studio, AI Workflow Builder (1,000+ actions), Event Studio, Ticket AI | Docs now redirect to an automationanywhere.com domain | — | Visionary in the 2025 Gartner MQ for AI Applications in ITSM. Third parties report it is now part of Automation Anywhere (consistent with the docs redirect; deal terms unverified). |
| **Atomicwork** | AI Coworkers (certified, custom, collaborating), Universal Context (IT graph), headless ITSM through MCP, single AI control plane | — | Budgets, spend limits and usage guardrails per AI Coworker. Data sovereignty in US, EU or APAC. | Deploys on top of Atomicwork, ServiceNow or JSM. Channels include Claude and ChatGPT Enterprise. |
| **AIOps-adjacent** | PagerDuty (Paige SRE Agent, Scribe, Shift and Insights agents; Probable Origins; noise reduction), BigPanda (AI Incident Prevention, AI Detection & Response, AI Incident Assistant, IT Knowledge Graph, Biggy AI), Dynatrace (deterministic causal AI, Dynatrace Assist, Developer / SRE / Security agents) | 2026 | — | Approval-by-default remediation (PagerDuty). Topology-based causal root cause analysis (Dynatrace). |
| **Microsoft 365 Copilot** (channel and reference design) | Copilot with Graph grounding and Semantic Index | Docs updated November 2026 | — | Reference for permission trimming: it "only surfaces organizational data to which individual users have at least view permissions". |

### Cross-vendor patterns worth copying

- **Suggest, then supervise, then act alone.**
  - Atlassian Request Resolver has a *Supervised* mode, where humans review the generated plan, and an *Autonomous* mode. Atlassian recommends promoting a request type to autonomous only after supervised results are consistently good.
  - ServiceNow's example agent always shows its recommendation before updating the record.
  - PagerDuty's Paige waits for approval on every remediation unless a team opts out.
  - TOPdesk's rule is "TOPdesk suggests, your operator decides".
- **Agents run as a real user.** ServiceNow's "Investigate and resolve" trigger must use *Run as: Assigned to*. Atlassian Ops Expert runs with the viewing user's permissions, so results differ between users. Request Resolver shows help seekers only what they are permitted to see, or what an agent has approved.
- **Abstain instead of guessing.** The ServiceNow categorization agent writes "Not determined" when the details are not clear.
- **State-aware, sectioned summaries.** ServiceNow's incident summary has sections (Issue, Key Actions Taken, Resolution, Affected CIs and Impacted Services, SLA, Child Incidents), and which sections are mandatory depends on the record's state.
- **Small and large model tiers per skill**, with the provider chosen per capability. ServiceNow 2026 apps use Claude Haiku 4.5 or GPT-5 mini for small tasks and Claude Sonnet 4.6 or GPT-5.4 for large ones. ManageEngine lets admins pick the provider for each GenAI capability.
- **Retrieval defaults.** ServiceNow AI Search RAG 6.1.0 switched its default chunking to *small-to-big*, with hybrid lexical plus semantic search.
- **Governance on by default.** ServiceNow Guardian prompt-injection detection runs always-on in blocking mode for skills. TOPdesk keeps AI off by default and labels AI content. Skill-level ACLs restrict who can run which AI feature.
- **AI-led implementation.** ServiceNow "Simplified ITSM" ships configuration agents for SSO, groups and roles, data imports, categories, routing rules, SLAs, notifications, change models, risk, CAB and change schedules.
- **Measure adoption and value.** InvGate splits adoption (who tried it) from engagement (who kept using it) and compares outcomes with and without AI. ServiceNow Now Assist Analytics has Executions and Business-value dashboards. ManageEngine's Zia Dashboard shows token consumption.

### Research limitations

- The shared web-search budget ran out after about 26 searches, so most verification came from about 45 direct fetches of official pages.
- Some official pages were blocked or cut off in the fetcher, including the Atlassian AI trust center, ServiceNow product pages and some SysAid docs. Claims that rest only on vendor marketing or third-party blogs are flagged in the text.
- Facts recalled from earlier knowledge are marked "(unverified)".

## Sources

**ServiceNow**
- https://www.servicenow.com/docs/r/zurich/it-service-management/now-assist-for-it-service-management-itsm/now-assist-itsm-skills.html — ITSM skill inputs and triggers (Zurich)
- https://www.servicenow.com/docs/r/it-service-management/agents-ai-native-it-service-desk.html — AI agents and agentic workflows in Simplified ITSM
- https://www.servicenow.com/docs/bundle/zurich-it-service-management/page/product/now-assist-itsm/concept/now-assist-itsm-aiagents-incident-resolver-workflow.html — "Investigate and resolve ITSM incidents" workflow
- https://www.servicenow.com/docs/bundle/zurich-it-service-management/page/product/now-assist-itsm/concept/now-assist-itsm-aiagents-catincidents-usecase.html — "Triage and categorize ITSM incidents" workflow (seen via search summary)
- https://www.servicenow.com/docs/r/intelligent-experiences/enable-ai-experiences/example-aia.html — example AI agent definition
- https://www.servicenow.com/docs/r/C17ZqvSaMwUVpMBg8Nc5sg/vHeRvBPXAQoVZMkZxx9P0g — July 16, 2026 Now Assist Suite release notes
- https://www.servicenow.com/docs/r/delta-yokohama-brazil/brazil-yokohama-nowassist-release-notes.html — combined Now Assist release notes, Yokohama to Brazil
- https://www.servicenow.com/docs/r/7GoNY9eeDRD0FzxldbEmXw/vm6nFtP22_i2Ewjo8Oy1oA — ServiceNow Otto and agentic AI release notes (Brazil)
- https://www.servicenow.com/docs/r/delta-xanadu-australia/australia-xanadu-nowassistforitservicemanagementitsm-release-notes.html — Xanadu-to-Australia ITSM notes (seen via search summary only; direct fetch returned 404)
- https://www.servicenow.com/community/enterprise-architecture-forum/ai-in-servicenow-the-complete-guide-2026/td-p/3611990 — community guide to the AI stack
- https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Otto-creates-the-unified-AI-experience-for-the-enterprise/default.aspx
- https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-Launches-AI-Control-Tower-a-Centralized-Command-Center-to-Govern-Manage-Secure-and-Realize-Value-From-Any-AI-Agent-Model-and-Workflow/
- https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-announces-new-agentic-AI-innovations-to-autonomously-solve-the-most-complex-enterprise-challenges-01-29-2025-traffic/default.aspx
- https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-completes-acquisition-of-Moveworks/default.aspx
- https://www.constellationr.com/insights/news/servicenow-knowledge-2026-ai-control-tower-action-fabric-autonomous-workforce-and
- https://www.reworked.co/digital-workplace/servicenow-launches-action-fabric-major-overhaul-of-ai-control-tower/
- https://s2-labs.com/blog/top-features-of-servicenow-brazil-release/ (third-party; Brazil timing, Build Agent MCP)
- https://www.moveworks.com/us/en/company/news/press-releases/servicenow-otto-creates-the-unified-ai-experience-for-the-enterp

**Atlassian**
- https://support.atlassian.com/organization-administration/docs/atlassian-intelligence-features-in-jira-service-management/
- https://support.atlassian.com/jira-service-management-cloud/docs/about-rovo-service (Request Resolver)
- https://support.atlassian.com/jira-service-management-cloud/docs/assess-potential-risks-to-your-changes-with-rovo-ops/ (Ops Expert change risk)
- https://support.atlassian.com/jira-service-management-cloud/docs/about-suggestions-on-issue-view/
- https://community.atlassian.com/forums/discussion/3214684/ai-risk-assessment-is-now-generally-available-in-jira-service-management
- https://support.atlassian.com/ja/jira-service-management-cloud/docs/incident-prevention-centre-in-service-collection/
- https://www.atlassian.com/roadmap/cloud/virtual-agent-for-jira-service-management

**Freshworks**
- https://www.freshworks.com/freshservice/ai-itsm/
- https://support.freshservice.com/support/solutions/articles/50000011728-freddy-ai-feature-overview
- https://support.freshservice.com/support/solutions/articles/50000009429-configure-freddy-ai-copilot-features
- https://support.freshservice.com/support/solutions/articles/50000014337-use-the-conversational-copilot-to-resolve-tickets-faster
- https://support.freshservice.com/support/solutions/articles/50000009156-freddy-ai-insights-overview
- https://support.freshservice.com/support/solutions/articles/50000010306 (Freddy AI Agent)
- https://support.freshservice.com/support/solutions/articles/50000006179-humanize-your-employee-and-agent-experience-with-freddy-ai-capabilities-powered-by-generative-ai
- https://support.freshservice.com/support/solutions/articles/50000008501-generate-ticket-summaries-using-freddy-ai

**BMC, Ivanti, ManageEngine, SysAid, Halo**
- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM/itsm262/Agentic-AI-capabilities-in-BMC-Helix-ITSM/
- https://docs.bmc.com/xwiki/bin/view/Service-Management/IT-Service-Management/BMC-Helix-ITSM-Service-Desk/servicedesk261
- https://docs.ivanti.com/neurons-for-itsm/admin-user-help/enu/latest/agentic-ai
- https://www.ivanti.com/ai/itsm
- https://www.uctoday.com/service-management-connectivity/ivantis-latest-release-puts-agentic-ai-itsm-into-commercial-deployment/
- https://www.manageengine.com/products/service-desk/itsm/2026-half-yearly-releases.html
- https://manageengine.com/products/service-desk/ai/next-gen-itsm.html
- https://documentation.sysaid.com/docs/copilot-setup.md (seen via search summary)
- https://usehalo.com/
- https://www.eesel.ai/blog/halo-ai-agent-review (third-party)

**Xurrent, Zendesk, InvGate, TOPdesk, Aisera, Atomicwork**
- https://www.xurrent.com/press-release/xurrent-extends-sera-ai-into-an-ai-sre-teammate-to-help-engineering-teams-resolve-incidents-faster
- https://www.apmdigest.com/xurrent-introduces-autonomous-agents-and-open-mcp-server
- https://www.xurrent.com/
- https://support.zendesk.com/hc/en-us/articles/5524125586330 (Copilot features)
- https://www.zendesk.com/service/ai/ai-agents/
- https://invgate.com/service-management/ai
- https://blog.invgate.com/ai-analytics-reports-in-invgate-service-management
- https://invgate.com/faq/invgate-service-management/ai-hub
- https://www.topdesk.com/en/solutions/ai-assisted-service-management/
- https://community.topdesk.com/news-and-announcements-125/topdesk-ai-launch-stay-up-to-date-with-all-updates-558
- https://docs.aisera.com/overview-of-aisera (redirects to docs-aisera.automationanywhere.com)
- https://aisera.com/press-release/aisera-named-a-visionary-in-2025-gartner-magic-quadrant-for-ai-applications-in-it-service-management/
- https://www.atomicwork.com/

**AIOps, platform references, security**
- https://www.pagerduty.com/platform/aiops/
- https://www.pagerduty.com/platform/ai-agents/
- https://www.bigpanda.io/
- https://www.dynatrace.com/platform/artificial-intelligence/
- https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-privacy
- https://genai.owasp.org/llm-top-10/

**Added in the second research pass**
- https://www.servicenow.com/docs/r/zS6yb8e~gR8BPjeviYdV9g/7ynO1YZ9eNIc45VD8R7Jow — Otto / Now Assist in Knowledge Management (Zurich, updated 2026-07-20)
- https://www.servicenow.com/docs/r/MlbQAgTiiiMOLOw9T36wJg/T0F9vvfJZCkBraC1ZGfUqg — generate a knowledge article from SOW / classic (seen via search summary)
- https://www.servicenow.com/docs/r/store-release-notes/store-rn-itom-now-assist-itom.html — Now Assist for ITOM store release history 2025–2026
- https://www.servicenow.com/docs/r/AcNUVbntjU97akN_E6wc8w/khegXcY9M_GL4dSuhh5BqQ — dashboard and visualization generation/export in the panel (seen via search summary)
- https://www.servicenow.com/docs/r/zurich/application-development/building-applications/vibe-code-now-assist-creator.html — Now Assist for Creator (seen via search summary)
- https://www.servicenow.com/community/intelligence-ml-articles/now-assist-in-conversational-catalog-request-guidance-for-making/ta-p/2987560 — conversational catalog guidance (community)
- https://www.servicenow.com/docs/r/intelligent-experiences/sn-ai-impl-nava.html — Now Assist in Virtual Agent readiness (seen via search summary)
- https://docs.helixops.ai/bin/Service-Management/Knowledge-Management/BMC-Helix-Innovation-Suite-Knowledge-Management/iskm263/Administering/Enabling-Knowledge-Curator-to-create-knowledge-articles-from-incidents-and-validate-them/ — BMC Knowledge Curator (seen via search summary)
- https://support.atlassian.com/jira-service-management-cloud/docs/manage-knowledge-bases-with-rovo/ — Rovo KB management, gaps (seen via search summary)
- https://support.atlassian.com/jira-service-management-cloud/docs/write-internal-knowledge-for-request-resolver/
- https://support.atlassian.com/jira-service-management-cloud/docs/update-the-request-types-of-issues-using-atlassian-intelligence — bulk triage of request types (seen via search summary)
- https://support.atlassian.com/rovo/docs/work-with-service-triage-agent/
- https://support.atlassian.com/jira-service-management-cloud/docs/alert-grouping-using-atlassian-intelligence — Rovo alert grouping (page body not rendered; facts via search summary)
- https://www.atlassian.com/blog/jira-service-management/how-atlassian-uses-ai-alert-grouping
- https://support.freshservice.com/support/solutions/articles/50000008514-help-article-generator
- https://support.zendesk.com/hc/en-us/articles/8558652714778 — Content Cues deprecation notice (seen via search summary)
- https://www.servicenow.com/docs/r/zS6yb8e~gR8BPjeviYdV9g/9_ru_zXyg8dOQGWRzHhrpA — Exploring Otto / Now Assist for CMDB
- https://www.servicenow.com/docs/r/q4dSP2Icgr1SFv5wanVXvQ/jxrD6PCdv0ukwjyQbQUeew — resolving de-duplication tasks with Now Assist (seen via search summary)
- https://www.servicenow.com/docs/r/store-release-notes/store-rn-itam-now-assist-sam.html — Now Assist / Otto for SAM store release history 2025–2026
- https://www.servicenow.com/docs/r/EdiPWhlSAqBiE0AMK4k9bQ/v2Mgkz9SzHy4AFggTEEY0Q — extract entitlements from software contracts (seen via search summary)
- https://www.servicenow.com/docs/r/store-release-notes/store-rn-itam-now-assist-ham.html — Now Assist for HAM release notes (seen via search summary)
- https://www.servicenow.com/docs/r/pyt4lF0aAin_R6wVyV414Q/iRnOJwFfsRBTqZeuB7kFlA — hardware model normalization (seen via search summary)
- https://www.flexera.com/products/compare/flexera-vs-servicenow-sam-pro — Flexera vendor comparison claims (marketing)
- https://www.flexera.com/sites/default/files/Flexera-One-ITAM-Datasheet.pdf — Flexera One ITAM datasheet (seen via search summary)
- https://community.atlassian.com/forums/Atlassian-AI-Rovo-articles/Your-Assets-data-at-your-fingertips-with-Rovo/ba-p/3241671 — Rovo over Assets (community)
- https://docs.helixops.ai/bin/Service-Management/Employee-Digital-Workplace/BMC-HelixGPT/helixgpt263/Pre-built-agents/ — BMC HelixGPT 26.3 prebuilt agent catalog
- https://docs.bmc.com/xwiki/bin/view/IT-Operations-Management/Operations-Management/BMC-Helix-AIOps/aiops262/Agentic-AI-capabilities-in-BMC-Helix-AIOps/ — BMC Helix AIOps 26.2 agentic capabilities (403 on fetch; facts via search summary)
- https://docs.helixops.ai/bin/Service-Management/IT-Service-Management/BMC-Helix-ITSM-Service-Desk/servicedesk261/Getting-started/Use-cases/Intelligent-service-prediction-in-incidents-with-BMC-Helix-classifier/ — BMC intelligent service prediction (seen via search summary)
- https://support.pagerduty.com/docs/intelligent-alert-grouping
- https://support.pagerduty.com/docs/auto-pause-incident-notifications
- https://support.pagerduty.com/docs/aiops
- https://www.datadoghq.com/blog/bits-ai-sre-deeper-reasoning/ — Bits Investigation (seen via search summary)
- https://www.datadoghq.com/about/latest-news/press-releases/datadog-named-a-leader-in-the-forrester-wave-aiops-platforms-q4-2026/
- https://lantern.splunk.com/Observability/Getting_Started/Working_with_machine_learning_in_ITSI (seen via search summary)
- https://help.splunk.com/en/splunk-it-service-intelligence/splunk-it-service-intelligence/release-notes-and-resources/4.20/release-notes/new-features-in-splunk-it-service-intelligence (seen via search summary)
- https://docs.bigpanda.io/docs/release-notes (seen via search summary)
- https://support.freshservice.com/support/solutions/articles/50000009156-freddy-ai-insights-overview — Freddy AI Insights (fetched in full this pass)
- https://www.eesel.ai/blog/zendesk-sla-breach-automations-and-alerts (third-party; Zendesk SLA automation conditions)
- https://www.servicenow.com/docs/r/9rlb2awQeTeY3Z9jGMo5DQ/Xj6mVRT02fWngH3DZJRCEA — summarize a security incident (SIR) (seen via search summary)
- https://www.servicenow.com/docs/r/AWjfoG0XNF6COBtQI5zL~A/tOOrBndblUVq154J5UBgqw — combined Now Assist for SIR release notes Yokohama→Australia (seen via search summary)
- https://www.servicenow.com/docs/r/x8~ohSTeWLioGLVI5x3Vgg/I0VIeK35OemfiXGuFo1lOg — Exploring Now Assist for Vulnerability Response (seen via search summary)
- https://www.servicenow.com/docs/r/zwMwt0JEh8FTHmrqXNjCAw/N3adyt5fCpx3Qx8~sE_IcA — VR agent collection, analyze remediation status (seen via search summary)
- https://www.servicenow.com/docs/r/teCgmdg6S2HWF~YnBhBwlg/SAgtTlfMSwNFbSlPAsFnjg — Exploring Now Assist for IRM (seen via search summary)
- https://www.servicenow.com/docs/r/zurich/governance-risk-compliance/issue-summarization-tprm.html — TPRM issue summarization (seen via search summary)
- https://www.servicenow.com/docs/r/de-DE/it-business-management/now-assist-for-strategic-portfolio-management-spm/generate-ai-status-report-na.html — SPM AI status report (seen via search summary)
- https://www.servicenow.com/docs/r/store-release-notes/store-itbm-rn-now-assist-spm.html — Now Assist for SPM release notes (seen via search summary)
- https://docs.ivanti.com/neurons-for-itsm-release-notes-enu-latest/whats-new-enterprise-service-management-20261 — Ivanti Neurons for ITSM/ESM 2026.1 what's new
- https://www.ivanti.com/company/press-releases/2026/ivanti-unveils-ai-driven-innovations-to-the-neurons-platform-to-power-the-future-of-it-and-security
- https://support.freshservice.com/support/solutions/articles/50000010306 — Freddy AI Agent (fetched in full this pass)
- https://invgate.com/faq/invgate-service-management/ai-hub — InvGate AI Hub capability list (fetched in full this pass)
- https://docs.moveworks.com/ai-assistant/getting-started/roadmap-release-notes/release-notes-2026 — Moveworks 2026 release notes (Jan–Feb)
- https://docs.moveworks.com/agent-studio/core-concepts — Moveworks Agent Studio plugin lifecycle (seen via search summary)
- https://www.moveworks.com/us/en/company/news/press-releases/moveworks-unveils-ai-agent-marketplace-to-enable-ai-agent-discovery-and-deployment-in-minute
- https://support.zendesk.com/hc/en-us/articles/10563281043738-Announcing-agentic-AI-for-advanced-email-AI-agents (seen via search summary)
- https://eesel.ai/blog/zendesk-ai-agents-advanced (third-party; May 2026 packaging change, language counts)
- https://www.servicenow.com/community/csm-blog/what-s-new-in-csm-for-australia-q1-26-release/ba-p/3532790 — CSM AI voice agents (seen via search summary)
- https://www.servicenow.com/docs/r/C17ZqvSaMwUVpMBg8Nc5sg/WkCbgwn1frCojoWOJXAQ0Q — April 28 2026 Now Assist Suite release notes (version list; seen via search summary)
- https://community.topdesk.com/news-and-announcements-125/new-on-mytopdesk-robin-out-ai-powered-chatbot-255 — TOPdesk Robin chatbot (seen via search summary)
- https://www.dutchitchannel.nl/news/760431/topdesk-presenteert-ai-assistent-robin — TOPdesk Robin AI teammate, Sept 2026 (seen via search summary)
- https://www.atlassian.com/software/jira/service-management/product-guide/tips-and-tricks/artificial-intelligence — JSM virtual service agent flow (intents first, then AI answers) (seen via search summary)
- https://www.servicenow.com/community/hrsd-blog/march-2026-store-release-deep-dive-blog-hrsd/ba-p/3506473 — HRSD March 2026 store release (seen via search summary)
- https://www.servicenow.com/docs/r/baBFTRuHLgu7HSwp0SUEQQ/Bmyj1coELJ17KKMLqpP8Bg — agentic workflows in Now Assist for HRSD (seen via search summary)
- https://www.servicenow.com/docs/r/zurich/field-service-management/now-assist-for-field-service-management-fsm/exploring-now-assist-fsm.html — Now Assist for FSM (seen via search summary)
- https://www.servicenow.com/docs/r/zurich/field-service-management/now-assist-for-field-service-management-fsm/now-assist-fsm-skill-inputs.html — FSM skill inputs (seen via search summary)
- https://www.servicenow.com/docs/r/XqB45azTkh_fhRBNTD2pSw/hcS9UySgEFj5iTp26aw1ew — Exploring Now Assist for CSM (seen via search summary)
- https://www.servicenow.com/docs/r/xanadu/customer-service-management/workforce-optimization-for-customer-service/explore-demand-forecast-configurable-wfo-cs.html — WFO demand forecast (STL) (seen via search summary)
- https://support.zendesk.com/hc/en-us/articles/9940054229402-Viewing-your-active-forecasts — Zendesk WFM forecasts (seen via search summary)
- https://www.zendesk.com/employee-service/workforce-management-software/ (seen via search summary)
- https://community.atlassian.com/forums/JSM-News-Discussions-articles/It-s-a-Rovo-roundup-Agent-releases-that-make-self-service-use/ba-p/3204587 — Rovo portal agents, escalation, Agent Evals (seen via search summary)
- https://www.servicenow.com/community/product-launch-blogs/introducing-autonomous-workforce-and-servicenow-employeeworks-ai/ba-p/3497917 — Autonomous Workforce and EmployeeWorks (seen via search summary)
- https://www.servicenow.com/docs/r/now-intelligence/exp-na-process-mining.html — Exploring Now Assist for Process Mining (seen via search summary)
- https://www.servicenow.com/docs/r/u~ldaY8ZPxJiUgZ1Inf6mw/k3E97oIe~ANjFH1wjsY~~A — Now Assist for Automation Center (seen via search summary)
- https://support.atlassian.com/analytics/docs/natural-language-to-sql/ — Atlassian Analytics NL→SQL (seen via search summary)
- https://support.atlassian.com/organization-administration/docs/atlassian-intelligence-features-in-atlassian-analytics/ (seen via search summary)
- https://www.manageengine.com/products/service-desk/itsm/2026-half-yearly-releases.html — ServiceDesk Plus 2026 releases (fetched again this pass)
- https://blog.invgate.com/ai-analytics-reports-in-invgate-service-management — InvGate AI analytics reports (fetched in full this pass)
- https://www.servicenow.com/docs/r/zurich/intelligent-experiences/now-assist-guardian.html — Now Assist Guardian (seen via search summary)
- https://www.servicenow.com/community/servicenow-otto-articles/ai-guardian-faq/ta-p/3601580 — AI Guardian FAQ (community; seen via search summary)
- https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-expands-AI-Control-Tower-to-discover-observe-govern-secure-and-measure-AI-deployed-across-any-system-in-the-enterprise/ (seen via search summary)
- https://www.servicenow.com/docs/r/zurich/intelligent-experiences/aia-eval-metrics-d27885e10395.html — agentic evaluation run results (seen via search summary)
- https://www.servicenow.com/community/now-assist-articles/agentic-evaluations-faq/ta-p/3429085 — agentic evaluations FAQ (community)
- https://www.servicenow.com/community/now-assist-articles/using-external-llms-with-now-assist/ta-p/3218103 — OOTB vs BYOK vs BYOLLM vs spokes (community)
- https://www.servicenow.com/docs/r/u1slaAtcFiiXFQcd9RcR_A/R0p5aEfuF7R0vV_RfFKWlA — Generative AI Controller release notes (seen via search summary)
- https://docs.helixops.ai/bin/Service-Management/Employee-Digital-Workplace/BMC-HelixGPT/helixgpt263/Getting-started/Key-concepts/Models-in-BMC-HelixGPT/ — Models in BMC HelixGPT 26.3 (seen via search summary)
- https://support.atlassian.com/rovo/docs/evaluate-the-performance-of-your-rovo-agent/ — Rovo Agent Evals (seen via search summary)
- https://community.atlassian.com/forums/Atlassian-AI-Rovo-articles/Introducing-Evaluations-for-Rovo-Agents/ba-p/3202093
- https://www.xurrent.com/product-updates/xurrent-itsm-july-2026-product-updates — Xurrent Closure and Triage agents (seen via search summary)
- https://www.xurrent.com/events/xchange — Xurrent August/September 2026 update list (seen via search summary)

## Module: platform

### Features
- **AI skill framework (prompt-backed "skills")** — A skill is a versioned unit with these parts:
  - inputs: table, field list, related lists, character budget;
  - a prompt template and a provider/model choice;
  - an output target: panel, field, work note or suggestion card;
  - triggers: UI action, condition rule, scheduled job, or the end of a chat;
  - role/ACL gating.

  In ServiceNow Zurich most out-of-box skill inputs cannot be changed; only summarization skills and Change risk explanation can be duplicated for customization. Custom skills are built, tested and published in the Skill Kit. [ServiceNow Now Assist / Now Assist Skill Kit / Generative AI Controller] [AI]
- **Contextual AI side panel** — A chat panel on any record that knows the record context and can answer, summarize, find similar items and take actions. [ServiceNow Now Assist panel; Freshservice Copilot "Ask me anything"; Rovo Chat; BMC "Ask HelixGPT"] [AI]
- **Context-menu AI actions on text fields** — Summarize, shorten, elaborate, change tone (casual / formal / sympathetic), or create and edit a knowledge article from an open prompt. Admins can:
  - set several configurations per field;
  - use advanced show/hide conditions for quick actions;
  - choose whether child tables inherit ("Enable for extended tables");
  - restrict context-menu skills, including the built-in shorten/elaborate/tone actions, with an ACL that checks user authentication (Yokohama Patch 6).

  Patch 3 added guided setup, share/copy/feedback on summaries, and Conversational Q&A in the panel. Patch 11 added the knowledge article create/edit, conditions, multi-config and extended-table options. [ServiceNow Now Assist context menu, Yokohama Patches 3/6/11] [AI]
- **LLM actions in flows and scripts** — Call an LLM (summarize, translate, generate, answer) from low-code flows and server scripts. [ServiceNow Generative AI Controller] [AI]
- **Voice input in the AI panel** — Accessibility and speed. [ServiceNow Yokohama Patch 3] [AI]
- **Dynamic translation and language detection** — Translate record and chat content in real time. [ServiceNow Language Services / Dynamic Translation; Freshservice Translator; TOPdesk AI Translation; Ivanti real-time translation] [AI]
- **AI-filled field indicators** — Fields filled by AI show a gradient marker so users know which values to check. [ServiceNow AI Lens 6.0.1] [AI]
- **AI Lens: screen and spreadsheet to record** — Fills forms from what is on screen. It also auto-maps Excel columns to table fields, choice values and reference values when importing. [ServiceNow AI Lens] [AI]
- **Record navigation, visual Q&A and document Q&A** — An agentic workflow that navigates table records and answers questions about images and documents. [ServiceNow Now Assist Platform Skills 3.0.3] [AI]
- **Schema-aware data Q&A** — Discovers table schemas and samples live data to answer questions without changing any data. [ServiceNow Common AI Framework 1.0.1] [AI]
- **Platform knowledge / context graph** — A graph of people, assets, CIs and work that grounds AI answers:
  - ServiceNow Knowledge Graph and Context Engine, with RaptorDB for real-time analytics and Workflow Data Fabric for zero-copy access to SAP, Snowflake and Databricks;
  - Atlassian Teamwork Graph;
  - Atomicwork Universal Context;
  - BigPanda IT Knowledge Graph. [AI]
- **Document Intelligence** — Extracts fields from invoices, forms and contracts. Vision AI Agent (renamed from DocIntel Vision AI Agent) accepts video up to 500 MB. [ServiceNow] [AI]
- **AI web agent** — A browser-automation agent for UIs without APIs; system property `keep_tab_open`, on by default. [ServiceNow Now Assist AI web agent 31.0.5] [AI]
- **Desktop agent** — An autonomous agent on employee desktops, sandboxed by NVIDIA OpenShell and governed by AI Control Tower. [ServiceNow Project Arc, announced at Knowledge 2026] [AI]
- **RPA and Task Mining** — Software robots for systems without APIs, and mining of repetitive desktop work. [ServiceNow RPA Hub, Task Mining] [AI]
- **AI metering plumbing** — Platform counters for AI consumption: Atlassian Rovo credits, Freshservice AI Agent sessions, ManageEngine Zia token consumption, Zendesk resolutions, ServiceNow "assists" (unverified for the 2026 packaging). [AI]

### Implementation notes
- **Data model:**
  - `ai_provider(id, kind[openai_compat|anthropic|gemini|local], base_url, secret_ref, models[], capabilities{tools,json,vision,embeddings,stt}, region, enabled)`
  - `ai_skill(id, key, module, input_spec{fields[], related[], max_chars}, prompt_template_id, output_schema(JSON Schema), model_tier[small|large|embedding|rerank], triggers[], roles[], auto_apply_policy, pii_policy, enabled)`
  - `ai_prompt_version(id, skill_id, text, created_by, eval_score, active)`
  - `ai_invocation(id, skill_id|agent_id, user_id, record_ref, input_hash, acl_fingerprint, provider, model, tokens_in, tokens_out, cost, latency_ms, status, output, citations[], guard_flags[], feedback, accepted, edit_distance)`
  - `ai_suggestion(id, record_ref, field, value, confidence, source[ml|llm|rule], explanation, state[proposed|accepted|rejected|auto_applied])`
- **Context builder (shared by every skill):**
  - Load the record with the caller's permissions: row-level security plus field masks.
  - Add journal entries (work notes and comments) in chronological order. Strip quoted email replies and signatures, and remove duplicate system notes.
  - Add related records the skill declares: SLA, CIs, child incidents, approvals.
  - Fit everything into the token budget. Keep the newest N entries verbatim and fold older ones into a rolling summary stored per record, regenerated incrementally (old summary plus new delta).
- **Output handling:**
  - Every generative output is a *suggestion* (Accept / Edit / Reject) unless the skill's `auto_apply_policy` allows writing it, for example a summary posted as a work note.
  - Write with an "AI-generated" badge and keep the invocation id for audit.
  - Track acceptance and normalized edit distance between the draft and the final text; this is the main online quality metric.
- **Caching:**
  - Key: `(skill, input_hash, acl_fingerprint, prompt_version, model)`.
  - Invalidate when any input field changes.
  - Never share a cached answer between users whose ACL fingerprints differ.
- **Async execution:**
  - Bulk and background skills (categorization at create, scheduled sentiment, clustering) run on a job queue with per-provider rate limits and retry with backoff.
  - Interactive skills stream tokens to the UI.
- **Provider abstraction:**
  - One interface `generate({messages, tools?, schema?, stream?})` with adapters for OpenAI-compatible (which also covers vLLM, Ollama, LM Studio, Together, Groq and Azure OpenAI), Anthropic and Gemini.
  - Normalize tool-call formats.
  - For local models without native tool calling, fall back to JSON-mode ReAct.
  - Keep a capability matrix so a skill needing vision or tools is never routed to a model that lacks them.

## Module: incident

### Features
- **Incident summarization** — Inputs (not editable in ServiceNow Zurich): Short description, Description, Work notes, Additional comments, Email.
  - Template sections and the states where each is required:
    - Issue: New / WIP / Resolved / Closed.
    - Key Actions Taken, Affected CIs and Impacted Services, Service Level Agreement, Child Incidents: WIP / Resolved / Closed.
    - Resolution: Resolved / Closed.
  - Triggered by the *Assign modal*, which opens on save when Assignment group or Assigned to changes, so the new owner gets a briefing.
  - On by default; available in Core UI and Service Operations Workspace; can be saved to the record with "Share as Work notes"; requires the `itil` role by default.

  [ServiceNow Now Assist for ITSM] [AI]

  Equivalents:
  - Freshservice Ticket Summariser: generated automatically on close only if the conversation has more than one message; title and description do not count toward that; service requests are excluded.
  - BMC incident summary (25.2) and Service Collaborator.
  - JSM "Summarize work items" (descriptions and comment threads).
  - Ivanti incident and ticket summarization.
  - InvGate one-click summary covering details, people involved and tasks performed, postable as an internal comment.
  - TOPdesk AI Incident Summarization (issue, solutions tried, current status; Excellent plan).
  - Zendesk ticket summaries, with admin-defined custom summaries per team.
  - ManageEngine Conversation Summary.
- **Resolution notes generation** — Drafts resolution notes from Description, Short description, Work notes and Additional comments. Runs on demand from the context menu or panel, or automatically when conditions are met (e.g. on Resolve). Refine actions: Shorten, Elaborate. [ServiceNow; BMC Service Collaborator (summarized resolution notes while resolving or closing); Freshservice Resolution Notes Generator; ManageEngine "Generated resolutions"] [AI]
- **Activity response recommendation** — Drafts work-note or comment replies from the record context. Default actions:
  - Work notes: "Summarize actions", "Post response".
  - Additional comments: "Follow up", "Post response", "Acknowledge task".

  [ServiceNow Incident activity response recommendation skill] [AI]
- **Suggested steps generation** — Groups similar incidents by short description and, by default, looks back 6 months at similar closed incidents to generate resolution steps. The filter conditions can be changed. [ServiceNow] [AI]
- **Incident Assist, now an agentic workflow** — The panel topics were "Find similar resolved incidents", "Consult on-call experts from support groups", "Retrieve caller's assets" and "Retrieve caller's recent incidents". In Australia Patch 1 the skill was deprecated and replaced by the *Incident Assist Agentic Workflow*. [ServiceNow] [AI]
- **"Investigate and resolve ITSM incidents" agentic workflow** —
  - Agent: *ITSM incident resolution plan investigation AI agent*.
  - Steps: (1) retrieve related catalog items, keeping the top 10 and selecting the most relevant, through AI Search; (2) check knowledge articles and similar resolved incidents; (3) generate recommended resolution steps.
  - Output: catalog item URLs plus the plan, written to Work notes; if no plan can be made, the user is told so.
  - Trigger: the incident moves to *In progress* with *Assigned to* filled. The trigger must be set to *Run as = Assigned to*. It can also be started by giving the incident number in the panel.
  - Visibility of the output is role-controlled (`itil` by default).

  [ServiceNow Zurich ITSM AI agent collection] [AI]
- **"Triage and categorize ITSM incidents" agentic workflow** — Several agents run in sequence:
  1. Set category and subcategory from the short description.
  2. Set service, service offering and configuration item.
  3. Link a major incident or known problem.

  The example "Categorize ITSM incident AI agent" (role: expert incident analyst) works like this:
  1. Fetch the incident, and stop if details are missing.
  2. Recommend a category only when the incident clearly matches one; pick the subcategory from that category's list; pick the CI from the caller's assigned CIs by name, manufacturer and asset name; otherwise use "Not determined".
  3. Present the recommendation with reasons *before* updating.
  4. Update the record.

  It never asks the user for input. [ServiceNow] [AI]
- **Escalation agentic workflow** — Weighs remaining SLA time, urgency, priority and impact, then assigns an escalation label (Critical / High / Medium) with a stated reason. [ServiceNow Platform AI Agents and Skills 13.0.8, 2026] [AI]
- **Next-action prediction and Quick Wins** —
  - Next-action prediction proposes actions such as attaching relevant KB articles, linking to a Problem, or updating form fields.
  - Quick Wins flags tasks likely to be quick to close.
  - Analyze Task Trends can filter by assignment group, service and CI.
  - Resolution-notes filtering can include AI updates (`include_ai_updates`).
  - Summaries can cite related records.

  [ServiceNow 13.0.8] [AI]
- **Incident sentiment analysis** —
  - Inputs: Short description, Description, Priority, State, Created, Additional comments, Task SLA.
  - Outputs: sentiment (Positive / Neutral / Negative), trend (Improving / Declining / Stable), and the reasoning behind it.
  - Runs from the scheduled job "Sentiment analysis scheduled job (incident)" (default true, configurable frequency).
  - Yokohama Patch 3 also shipped a Sentiment Analysis app that measures satisfaction per record.

  [ServiceNow] [AI]

  Equivalents: Freshservice Ticket Sentiment Analysis (Negative / Neutral / Positive, change over time, optional explanation of influencing factors); Zendesk intelligent triage sentiment; JSM "Show customer sentiment"; ManageEngine sentiment analysis.
- **JSM "Suggestions" on work items** — The right panel shows:
  - a brief summary;
  - for requests, reporter details and possible steps;
  - for incidents, a *probable root cause*, which needs past similar incidents that have PIR tickets plus the Impact field;
  - suggested actions. Incidents: mark as major incident, add responders, set severity, change priority, add affected services, or create a problem work item. Requests: change priority, add or update the assignee.

  It adapts to "available context and past similar work items". It cannot be configured, and KB content does not influence it. [Atlassian JSM] [AI]
- **Similar / related incident suggestions** —
  - Freshservice Similar Incident Suggester (English only) and Resolution Insights (likely root cause and fix steps from similar resolved tickets).
  - Zendesk Similar tickets (recently solved or closed tickets on the same issue, even if worded differently).
  - InvGate similar open and closed requests at creation.
  - JSM similar requests.
  - Halo AI ticket matching (vector-based matching per a third-party description).
  - ServiceNow similar resolved incidents.

  [AI]
- **Merge / duplicate suggestions** — Zendesk lists tickets from the same requester created up to two weeks before or after the current one, in the Intelligence panel. [Zendesk Copilot] [AI]
- **Find initiating changes** — Ranks changes closed in the last 14 days that are likely related to the incident, and can link them. [Freshservice Copilot] [AI]
- **Field autofill / classification / routing** —
  - Freshservice Field Autofill Suggester.
  - Ivanti ticket classification and routing.
  - SysAid AI Intelligent Categorization (categorize and route).
  - TOPdesk AI Triage (category, priority and operator group at open; basic on Engaged, full on Excellent).
  - InvGate category, priority and linked major incident.
  - ManageEngine auto-categorization, priority estimation and technician assignment.
  - Halo Neo agent triage (third-party).
  - Zendesk intelligent triage: intent, entity, sentiment, language.

  [AI]
- **Major incident (MI) support** —
  - Detection: ServiceNow AI-driven incident clustering (Australia); InvGate Major Incident Detection (analyzes patterns and impact, notifies coordinators); Ivanti incident correlation (flags potential major incidents).
  - Communication: ServiceNow *Major Incident email content recommendation*. It uses Short description, Description, Additional comments, Work notes, Activities, Business impact and Resolution notes, plus Task SLA fields (Target, Stage, Actual / Business time left, Has breached, Pause duration and time), incident Priority and CI, and optionally Collaboration chat payloads. It fills Gen-AI variables in email templates.
  - Reports: BMC Major Incident Report (MIR) generation (26.1); Freshservice Post Incident Report Generator (from creation through resolution); JSM PIR summary; ManageEngine PIR Generator agent; Xurrent Sera Recap.

  [AI]
- **Swarming in chat** — BMC Helix Ops Swarmer in Microsoft Teams incident channels provides:
  - incident summaries, work notes, chat summaries and participant timelines;
  - incident lookup by partial number, plus HPD:Association and third-party fields;
  - recommended participants for incidents and changes;
  - on-call lookup through xMatters or PagerDuty;
  - BMC Helix AIOps "Situation" details and a visual incident timeline (26.1).

  JSM offers an incident timeline and incident summary in Slack. [AI]
- **Email-driven automation** —
  - BMC answers inbound-email incidents automatically with a knowledge summary, a recommended resolution and an option to resolve (25.2).
  - When an incident moves to *Pending*, BMC analyzes why and emails the customer.
  - SysAid AI Emailbot replies to email-created records with a chatbot answer.
  - Freshservice Email Bot detects intent.

  [AI]
- **Autonomous incident handling** — ServiceNow L1 IT Service Desk AI Specialist (GA 2026); BMC Ticket Resolver (26.2); Atlassian Request Resolver; ManageEngine "L1 ServiceDesk Specialist" Zia agent; Xurrent autonomous agents (triage, knowledge, ticket closure); Halo AI agents via runbooks; Atomicwork Incident Manager AI Coworker. [AI]
- **Expert and collaborator suggestion** — InvGate Expert Collaboration (most qualified collaborator, across departments); ManageEngine Collaborator Suggestion (learned from sharing history, subject and description); ServiceNow "Consult on-call experts". [AI]
- **Multimodal input** — Freshservice image support (extracts insights from screenshots); ServiceNow Vision AI Agent. [AI]

### Implementation notes
- **Trigger map:**

  | When | Async work |
  |---|---|
  | on create | categorize, prioritize, route, detect duplicates or MI clusters, link known problems |
  | on assignment change | handoff summary posted as a work note (ServiceNow pattern) |
  | on first open by a new assignee | "catch-up" summary if more than 30 min stale |
  | on new customer comment | refresh sentiment, suggest a reply |
  | on resolve | resolution notes draft, KB candidate check |
  | on close | KB draft if no linked article and the resolution was novel (low similarity to the existing KB) |

- **Abstention:** every field suggestion carries a calibrated confidence. Auto-apply at or above the tenant threshold (e.g. 0.9 precision on a validation set), suggest in the middle band, and output "Not determined" below it.
- **Major incident candidate detection:**
  - Sliding 60-minute window.
  - Add an edge between two new incidents when embedding cosine ≥ 0.82, or when they share a CI or service and cosine ≥ 0.70.
  - A connected component becomes an MI candidate when its size ≥ k (default 5), it has ≥ 3 distinct callers, and the burst is significant (Poisson tail p < 0.01 against the hourly baseline for that service).
  - Propose a parent incident with an LLM-written title and description, and attach the children only after a human confirms.
- **Portal-side duplicate deflection:** before submit, run a similarity search over the requester's open incidents (cosine ≥ 0.9) and over open incidents on the same service. If there is a hit, offer "This looks like a known issue — add me as affected" instead of creating a new incident; this records the affected user on the parent.
- **Agentic workflows** run as the assigned user (an on-behalf-of token). Their output goes to work notes flagged as AI, visible to the `itil` role by default.
- **Sentiment job:** process only active incidents with new public comments since the last run. Store per-comment scores and compute the trend as the slope over the last N comments.

## Module: problem

### Features
- **Problem candidate detection (recurring-incident clusters)** —
  - BMC Problem Solver (26.2.01) detects recurring incidents and creates problem candidates. Its console lets users ask questions in natural language about the candidate clusters (26.2.00).
  - ManageEngine Zia Cluster Analysis (Enterprise) groups similar incidents using custom filters and thresholds, and replaces Zia Problem Prediction.
  - InvGate Common Problem Detection finds patterns across related tickets, surfaces root causes and notifies the team.
  - ServiceNow Predictive Intelligence clustering.
  - Ivanti incident correlation.

  [AI]
- **Link to known problems at triage** — The ServiceNow triage workflow links incidents to known problems and major incidents. The next-action skill can link cases to Problem records. JSM suggests "investigate by creating a problem work item". [AI]
- **RCA and problem-statement drafting** — ManageEngine PIR and RCA generation; Xurrent Sera Recap (post-incident documentation and RCA); Freshservice Resolution Insights (likely root cause from similar resolved tickets); JSM probable root cause, which needs PIR history. [AI]
- **Problem summarization** — Summaries for problem records. ServiceNow's 2026 changes add work-plan summaries and auto-classification of records. A dedicated ITSM problem summarization skill was not found in the Zurich skill list (unverified). [AI]
- **Post-incident review generation feeding problem management** — Atlassian generates the incident summary for a PIR and keeps a Slack timeline. BMC MIR. Freshservice Post Incident Report Generator. [AI]
- **Incident prevention** — Atlassian Prevention Center (EAP), an "AI-native incident prevention command center" in Service Collection Change Management. Its *Change Pre-risk Assessment* scans high-level signals and historical patterns. BigPanda AI Incident Prevention. [AI]
- **Reliability gaps from post-incident data** — The *Reliability Domain Agent* finds SLO and synthetic-monitoring gaps from post-incident data and creates reliability tasks. [ServiceNow AI agents for SLO 2.0.3] [AI]

### Implementation notes
- **Candidate pipeline (nightly):**
  1. Take incidents from the last 30–90 days that have no problem link and are not restricted record types.
  2. Embed short description, description and resolution notes. HDBSCAN works well: it needs no fixed k and ignores noise. Alternatively, agglomerative clustering with a cosine threshold of about 0.78.
  3. Split each cluster by service or CI when the variance is high.
  4. Score: `size × mean_priority_weight × recurrence_span_days^0.5 × (1 + reopen_rate) × business_criticality(service)`.
  5. Drop clusters already covered by an open problem (centroid similarity to the problem statement ≥ 0.8).
  6. An LLM writes the cluster label, a draft problem statement, a hypothesized cause and the evidence, citing incident numbers. Every claim must cite at least one incident.
- **RCA drafting prompt:**
  - Structured JSON: `{symptoms, timeline[], hypotheses[{cause, evidence_refs[], confidence}], five_whys[], contributing_factors[category: people|process|technology|supplier|environment], workaround, permanent_fix_options[], action_items[]}`.
  - Ban unreferenced claims, and show "insufficient evidence" when retrieval is weak.
- **KEDB surfacing:** when an incident is created, retrieve known errors (problem workaround fields) by hybrid search. Show the workaround with a "Apply workaround" action that logs the link.
- **Action items** from PIRs become problem tasks with owners and due dates. Track their completion as a problem-management KPI.

## Module: change

### Features
- **Change request summarization** — Inputs (not editable): Short description, Description, Work notes, Additional comments, Risk, Impact, Justification, Implementation plan, Risk and impact analysis, Test plan, Backout plan, Close code, Close notes, Service offering, State, Conflict status, Type.
  - Sections and the states where each is required:
    - Objective, Plan, Risk, Affected CIs, Impacted services: Assess, Authorize & Scheduled, Implement & Review, Closed.
    - Close notes and Incidents caused by change: Closed.

  [ServiceNow] [AI]
- **Change risk explanation** — A narrative of why the risk level is what it is. Inputs: Short description, Implementation plan, Assignment group, Risk, Description, the backout plan (listed as "Blackout plan" in the source), Model type, similar change requests and the incidents they caused, and the risk condition that fired. It can be duplicated for customization. [ServiceNow] [AI]
- **Risk assessment answer generator** — Suggests answers, with reasoning, to the risk assessment questionnaire.
  - Reads a configurable field set (system property `sn_itsm_gen_ai.com.snc.asmt_answer_generator.change_request_fields`).
  - Uses the "AI Risk Data Sources": affected CIs, impacted services, impacted business applications, service offerings, active change tasks, and outages linked to the change. These can be created, modified or deactivated.
  - Started from "Generate Risk Assessment Using Otto" (Core UI Related Links, or Assess Risk in Service Operations Workspace 9.2+).

  [ServiceNow] [AI]
- **AI change risk assessment (Ops Expert, formerly Rovo Ops)** — Premium / Enterprise; not HIPAA-compliant.
  - Reads: description, comments, links, mentioned URLs, linked KB articles the user can access, connected deployment pipelines, and repository or PR links.
  - Technical dimension (admin-toggled): open and past incidents with similar root causes, related PIRs, failed deployments, changes rejected on the same service in the last 90 days, gaps in test / rollback / implementation plans, data-migration or compatibility issues, and a basic static analysis of linked code (security issues, memory leaks).
  - Operational dimension: scheduling conflicts on the same services or assets, stakeholders (owners, responders, incident managers, asset owners), infrastructure changes with downtime risk, rollback complexity.
  - Outputs: Low / Medium / High plus a confidence score, a narrative and suggested mitigations from similar changes and incidents. Accepting a mitigation creates a task work item titled with the change key.
  - Runs under the viewing user's permissions.
  - Never approves or rejects on its own.

  [Atlassian] [AI]
- **Predictive risk and impact** — InvGate suggests risk and impact values for change requests from historical and similar cases. ManageEngine Change Risk Prediction covers release-related changes too. BigPanda Change Risk Management analyzes risk to support faster approvals. [AI]
- **Similar change suggester** — Surfaces recent changes similar to the current change request and accepts feedback. [Freshservice Copilot] [AI]
- **Root-cause changes for incidents** — Freshservice Find Initiating Changes (14-day window). BigPanda "identify root cause changes" inside ServiceNow. [AI]
- **Change configuration agents (AI-led setup)** — Each configures one part of change management:
  - Change Forms and Change Lists Configuration Agents.
  - Change Team Role Configuration Agent, with optional upload of PDF / DOCX / XLSX / CSV.
  - Change Risk Configuration Agent (risk questions, score thresholds, risk levels that route to approval workflows).
  - CAB Configuration Agent (with document upload).
  - Change Models Configuration Agent (Normal / Standard / Emergency / Change Registration).
  - Change Schedule Configuration Agent (blackout and maintenance schedules).

  [ServiceNow Simplified ITSM] [AI]
- **Change success score / DevOps change acceleration** — Team- or pipeline-level success history feeds auto-approval policies. [ServiceNow DevOps Change Velocity] [AI] (unverified)
- **Implementation / backout / test plan drafting** — Generate plans from similar successful changes, standard-change templates and CI runbooks. Freshservice offers a *Test Case Generator* ("creates test cases from issue context"). Explicit plan-drafting skills at other vendors are (unverified). [AI]
- **CAB support** — Agenda building, change summaries for CAB packs, and conflict highlights. [AI]
  - BMC HelixGPT *CAB Supervisor* assesses whether a change request is ready and recommends an approval decision.
  - BMC *Change Coordinator* validates a change and assesses its risk automatically when it reaches a configured status.
  - BMC *Change Risk Advisor* (AIOps) flags risky changes using operations and service-management data.
  - At other vendors, CAB packs are built from the summary, risk and conflict skills above. A dedicated CAB-minutes generator was not found (unverified).
  - Even BMC's agent only *recommends*; the approval stays human.

### Implementation notes
- **Risk model** (per tenant, retrained monthly):
  - Label = failed, backed out, or caused an incident within 7 days (incident caused-by link).
  - Features: change model/type; lead time; implementation window length; weekend or night flag; number and criticality of CIs; blast radius (count of downstream CIs within 2 hops in the CMDB dependency graph, weighted by service tier); CI failure rate (Beta-smoothed: `(fails+1)/(changes+2)`); assignee and group failure rate (smoothed); a collision flag (another change on the same CI or a dependent CI with overlapping windows); inside blackout; plan-quality score (LLM rubric 0–5 for implementation, backout and test plans: present, specific, verifiable); a pipeline signal (CI tests passed, deployment success history).
  - Model: logistic regression, for its interpretable coefficients, or GBM with SHAP values. Calibrate with isotonic regression.
  - Present `P(fail)`, mapped to Low / Medium / High by tenant thresholds, together with the top 3 contributing features. The LLM narrates only those features ("explanation must reference only provided factors").
- **Mitigations:** retrieve the k most similar changes that failed (embedding plus same CI class). Extract the remediation actions from their PIRs and problems, and propose them as task suggestions.
- **Collision detection:** use interval overlap on the same CI, or on CIs within k hops (dependency direction matters). Block windows that overlap blackout schedules unless the change is an emergency.
- **Permissions:** compute the risk with service privileges, so all historical changes count, but render evidence such as similar changes or incidents only if the viewer can read them. This mirrors Ops Expert, which resolves linked resources with the viewing user's permissions.
- **Guardrail:** AI never moves a change to Authorized. Auto-approval stays a deterministic policy, for example standard changes with a low risk score and a clean pipeline.

## Module: release

### Features
- **Release notes generation** — Drafts release notes from linked changes, stories, commits and PRs. "Release notes generation" appears in ServiceNow's Now Assist skill listings; its exact scope is unverified. [ServiceNow] [AI]
- **Release risk prediction** — Forecasts a release's risk value from preset filters. [ManageEngine Zia Risk Prediction] [AI]
- **Release engineer prediction** — Suggests the best release engineer by indexing release fields, using preset filters. [ManageEngine Zia] [AI]
- **Test case generation** — Creates test cases from issue context. [Freshservice Copilot Test Case Generator] [AI]
- **Deployment gating and pipeline-aware risk** — Atlassian "Set up deployment gating" and the pipeline and code signals in Ops Expert (gating details unverified). Code-level fix proposals: Dynatrace Developer agent; ServiceNow Now Assist for Impact Code Fix Agent, which explains errors in plain language on the remediation record. [AI]

### Implementation notes
- **Release risk** = an aggregate over child changes. Use the maximum child risk combined with a count term, `1 - Π(1 - p_i)`, as the probability that at least one child fails. Then add release-level features: number of teams, number of services touched, and freeze-window proximity.
- **Engineer recommendation:** build an expertise vector per engineer, the centroid of embeddings of releases and changes they completed successfully. Rank engineers by cosine with the release's description and components, then filter by availability (calendar) and by a load cap.
- **Release notes:** collect linked changes, stories and PRs, and classify each item as feature / fix / security / breaking. Generate per-audience variants (end user vs. technical), and require each line to cite the source item key.

## Module: request

### Features
- **Conversational catalog ordering** — Users order catalog items in natural language; the assistant asks clarifying questions, fills the item's variables from the conversation and confirms before submitting. [AI]
  - ServiceNow Now Assist in Virtual Agent ("conversational catalog"):
    - Items must be marked *conversational*; a checkbox on the catalog item, "Turn off Now Assist conversation for this item", keeps an item away from the LLM when its variables or answers are sensitive.
    - Supported variable types include Attachment, Date, Date/Time, Duration, Email, HTML, IP Address, Label and Lookup Multiple Choice without pricing; Break is ignored; advanced reference qualifiers work. Some scripted UI policies, some client scripts and GlideAjax are not supported (community guidance; check per release).
    - A question-limit property (`sn_now_assist_cr.llm.conversational.request.question.limit`) caps how many variables a conversational item should have.
    - A *Conversational Catalog Overview* dashboard shows which items are conversational.
    - An LLM assistant must be configured and assigned to each portal, or LLM topics are not discoverable.
  - Equivalents: JSM virtual service agent intents that collect form fields in chat and raise the request; Freshservice Freddy AI Agent requests in Slack, Teams and portal (catalog depth unverified); Moveworks and Aisera access and software requests in chat; Atomicwork AI Coworkers.
- **Request-type and field classification of free-text and email requests** — [AI]
  - JSM bulk *Triage*: in a queue, select work items and choose Triage; Atlassian AI suggests a request type for many items at once. It is aimed at mail that lands under the generic "Emailed request" type, and request types with required fields the AI cannot fill are left out of the list.
  - Rovo *Service Triage* agent suggests the request type from summary and description.
  - Other vendors classify request type and category as part of incident triage (see Module: incident): Freshservice Field Autofill, TOPdesk AI Triage, ServiceNow triage agents.
- **AI-generated request types and catalog items** — [AI]
  - JSM: Project settings → Create request type → *Create using AI* suggests request types from a description of the team's work (Premium / Enterprise, company-managed spaces).
  - ServiceNow Now Assist for Creator *Catalog Item Generation* produces Service Catalog items, with variables, from descriptive text.
- **Related catalog item recommendation** — When an agent works an incident, the ServiceNow resolution agent retrieves related catalog items through AI Search (top 10, then the most relevant) and adds their URLs to the plan. Portals surface catalog items as AI Search results (see Module: portal). [AI]
- **Autonomous request resolution** — Agents fulfil routine requests end to end. [AI]
  - Atlassian Request Resolver (formerly Rovo Service): builds a *resolution plan* (100 Rovo credits each) that runs in Supervised mode (an agent reviews the plan) or Autonomous mode per request type. It follows internal knowledge written for it, and help seekers see only what they may see or what an agent approved.
  - ServiceNow L1 IT Service Desk AI Specialist.
  - Freshservice Freddy AI Agent.
  - Zendesk AI agents running natural-language *procedures*.
  - Moveworks, Aisera, Atomicwork AI Coworkers, Xurrent autonomous agents.
- **Fulfilment actions through tools** — Typical agent tools: password reset and MFA reset (IdP), group and app access (Okta, Entra ID), software install (endpoint management such as Ivanti or ManageEngine Endpoint Central), mailbox and distribution-list changes, license assignment, device lookup, order status. Moveworks, Aisera and Atomicwork lead on breadth of prebuilt actions; ServiceNow Integration Hub spokes and Freshservice Copilot Actions / AI Agent Studio are the platform equivalents. [AI]
- **Pre-submit deflection** — The portal answers the question, or offers a known-issue "add me as affected", before a request is created (see Module: portal). [AI]

### Implementation notes
- **Catalog items as tools.**
  - Expose each eligible catalog item as an LLM tool. Name and description come from the item; parameters are a JSON Schema generated from the variables.
  - Type mapping: single-line text → string; select box → enum (labels, with values mapped back on submit); reference → string resolved through a server-side lookup tool that applies the reference qualifier *as the requester*; date → `format: date`; checkbox → boolean; attachment → file id.
- **Eligibility is computed, not hand-set.**
  - An item is conversational only if every variable type is supported, it has at most N questions (default 10), it has no client script that changes other answers, and it is not flagged sensitive.
  - Other items fall back to a deep link to the form, prefilled with whatever was already extracted.
- **Ordering loop:**
  1. Retrieve candidate items by hybrid search over name, description, keywords and example utterances, filtered by the requester's catalog audience (user criteria).
  2. The LLM picks one item, or asks a disambiguation question.
  3. Slot filling: ask for one missing required variable at a time, and accept several answers in one message.
  4. Run the *server-side* form validation (mandatory fields, regex, reference qualifiers, UI-policy equivalents written as declarative rules).
  5. Show a confirmation card, then submit through the normal API as the requester, so approvals, pricing and fulfilment workflows run unchanged.
- **Email triage classifier:**
  - Shortlist the top 15 request types by embedding similarity of the email (subject plus body, with signatures and quoted replies stripped).
  - The LLM picks one and returns `{request_type, confidence, fields{}}` with JSON-schema output.
  - Apply it only if every required field of the target type can be filled; otherwise leave the item in the triage queue with the suggestion attached.
- **Supervised → autonomous promotion (Request Resolver pattern):**
  - Track per request type: plan acceptance rate, edit rate, reopen rate within 7 days, CSAT.
  - Offer autonomy when, for example, acceptance is at least 95% over the last 50 plans and no safety incident occurred.
  - Demote automatically when the reopen rate crosses a threshold.
- **Metering:** count one unit per resolution plan or autonomous resolution, not per token, so admins can budget; warn at 80% and 100% of the allowance, as Atlassian does.

## Module: knowledge

### Features
- **KB article generation from incidents and cases** — Drafts an article (or KCS template sections) from a resolved record. [AI]
  - ServiceNow (Now Assist / Otto in Knowledge Management, Zurich):
    - Entry points: Service Operations Workspace, Core UI, or the panel. In the panel, an agent can enter a task number to generate without opening the record.
    - Condition: the incident must be Resolved or Closed with no article already attached, unless the property `com.snc.incident.create_knowledge.multistate.enable` allows other states.
    - Inputs: short description and description for incidents.
    - In Core UI, a pasted short description finds the top 3 similar incidents; the generated article is attached to every selected incident.
    - The KCS article template needs the *KCS Integration for Incident Management* plugin. Custom prompts can extend the out-of-box KB generation skill to out-of-box and custom article templates.
    - Articles can be generated in several languages.
    - Known limitation: once triggered, generation cannot be stopped.
  - BMC HelixGPT *Knowledge Curator* agent:
    - Inputs are the incident summary, description and work notes. Admins can add context fields in the *GPT Configuration* record definition, but must also update its instructions or the new fields are ignored.
    - Suggestions appear in the *Ask HelixGPT* tab for the agent to accept or edit. In Innovation Suite Knowledge Management the article is created *In progress*.
    - A second agent validates the article (*BWF - Generate IS Validate*).
    - Supported in BMC Helix Knowledge Management by ComAround and in ISKM.
    - Enabled by "Enable HelixGPT Knowledge Curator" in Incident Rules.
    - Models listed for 26.2: GPT-4.1, GPT-4.1 mini, GPT-5.1, Gemini 2.5 Flash. Only out-of-box templates are supported.
  - Atlassian Rovo:
    - `/manage-knowledge-base` with "create KB article from issue SRV-123" saves a draft to the linked Confluence space, reading description, comments and activity.
    - Atlassian recommends generating from about ten resolved work items, then merging and tidying the drafts.
  - Freshservice *Help Article Generator* (Copilot add-on): generates solution articles from public sources and existing tickets; admin KB → New article → enter a topic.
  - ManageEngine *Solution Generator* writes multilingual solutions. *Solution Assist* indexes KB attachments (PDF, DOCX, DOC, MD, TXT, HTML, HTM) so answer excerpts can come from them.
  - Ivanti: generates knowledge articles for incidents (product page).
  - InvGate *Knowledge Discovery* (cloud only; needs the virtual service agent) mines historical requests and suggests knowledge snippets for coverage gaps. *Improve Content* in the editor summarizes, expands, refines and changes tone, with apply, discard and undo.
  - Also: TOPdesk Knowledge Item Creation; ServiceNow AIOps LEAP, which writes KB articles with command snippets and playbooks through guided chat; ServiceNow FSM, which generates an article after a work-order task closes.
- **Writing assistance in the article editor** — [AI]
  - ServiceNow: expand and shorten in the TinyMCE context menu (knowledge content recommendation skill), and the Knowledge Center content editor with custom instructions.
  - Atlassian: Rovo editor actions in Confluence.
  - Zendesk: help-center editor rewrite and tone tools.
  - TOPdesk: Writing Assistant.
- **Knowledge gap detection** — Finds topics with demand but no article. [AI]
  - ServiceNow *Knowledge Gaps* skill, activated in the AI admin console.
  - Atlassian: "show gaps in knowledge base" through the KB management skill. An AtlasCamp 2026 session showed a Rovo agent that scans recently resolved tickets, checks for existing articles, and drafts new ones where it finds a gap.
  - Zendesk *Knowledge Base Gaps Discovery* (Ultimate tier) mines AI-agent (bot) conversations. It replaced *Content Cues*, which mined tickets and was deprecated on 2025-05-01. Explore also reports top searches that returned nothing.
- **Duplicate article identification** — ServiceNow "identify duplicate articles" skill, for admins and knowledge managers. (Zendesk Content Cues also did this before its retirement.) [AI]
- **Article Optimization (quality scoring and improvement)** — ServiceNow Article Optimization (AO): a default skill, customizable prompts, standalone custom skills, and scan settings in Knowledge Center. Classic KCS practice scores articles with an Article Quality Index (AQI) checklist; AI turns that into an automated rubric. [AI]
- **Multilingual knowledge** — ServiceNow: the AI admin console sets the languages per third-party model provider and enables native and dynamic translation. TOPdesk AI Translation; JSM and Zendesk answer in the requester's language. [AI]
- **Agent-executable knowledge** — Knowledge written for AI agents to *follow*, not only for humans to read. [AI]
  - Atlassian "Write knowledge Request Resolver can follow" and "internal knowledge for Request Resolver": internal procedures that help seekers never see.
  - Zendesk procedures in natural language.
  - Halo runbooks.
  - ServiceNow AIOps LEAP playbooks.
- **Answering from knowledge** — Generative answers with citations in the portal and in chat: ServiceNow AI Search Genius Results / Q&A, JSM AI answers, Zendesk generative search, Freshservice AI Agent, TOPdesk Answer Assistant. See Module: portal. [AI]

### Implementation notes
- **Generation pipeline:**
  1. **Candidates:** resolved incidents whose resolution code is not duplicate, user-error or cancelled, and that have no linked article.
  2. **Novelty check:** keep candidates whose maximum cosine similarity to the existing KB (title plus problem section) is below 0.80.
  3. **Clustering:** group 3–10 similar resolved incidents and generate one article per cluster, as Atlassian advises with ~10 items.
  4. **Template:** KCS — Issue, Environment, Cause, Resolution, plus keywords.
  5. **Scrubbing:** remove PII and secrets (names, emails, phone numbers, IPs, hostnames if policy says so, tokens) and swap internal jargon for portal terms.
  6. **Citations:** each step cites the source incident numbers, kept as hidden metadata.
  7. **Workflow:** save as *Draft* (or *In progress*) and route through the normal review and publish flow. Never auto-publish external-facing content.
- **Validation agent (BMC pattern):** a second LLM call checks the draft against the sources for unsupported claims, missing prerequisites, unsafe commands and PII. It outputs `{issues[], score}` and blocks submission below a threshold.
- **Gap score** per topic cluster: `demand × (1 − coverage)`.
  - Demand = incident count + zero-result searches + AI-agent escalations where the answer was "I don't know".
  - Coverage = maximum similarity of the cluster centroid to any published article *readable by the affected audience*.
  - The LLM names the topic and proposes an outline.
- **Duplicates:**
  - Candidate pairs: MinHash/LSH for near-identical text, plus embedding cosine ≥ 0.90 for paraphrases.
  - An LLM judge labels each pair *duplicate*, *overlapping* or *distinct* and proposes a merged version with a redirect.
- **Quality and freshness score** (shown to authors and managers):
  - **LLM rubric (AQI-like):** title states the symptom, environment given, steps numbered and verifiable, single issue, no internal-only data, links resolve.
  - **Behavioural signals:** helpful votes, link and reuse rate on incidents, "viewed then still opened a ticket" rate.
  - **Freshness signals:** age since last review, references to retired CIs, services or product versions (check mentioned versions against the CMDB and SAM catalogue), broken links, and a recent spike in incidents linked to the article that were later reopened.
- **Chunking for retrieval:** heading-aware chunks of 300–800 tokens with the article title and breadcrumb prepended. Store the article's ACL (KB plus user criteria) on each chunk so retrieval can be pre-filtered (see Access control).

## Module: cmdb

### Features
- **Natural-language CMDB search** — ServiceNow Otto (Now Assist) for CMDB *Search CMDB* agentic workflow. [AI]
  - Turns a request phrased in CI attributes into one of three query types: a keyword search, a single-table query with dot-walks, or a multi-table query that follows relationships.
  - It can infer relationship data to build the query.
  - Atlassian equivalent: Rovo reads Assets schemas, object types, attributes and relationships and turns questions into AQL. This is read-only, and community reports note hallucinated object names when the schema is not named in the prompt (community sources, not vendor docs).
- **Conversational CI creation** — ServiceNow *Create configuration item* agentic workflow. [AI]
  1. Confirm the CI class.
  2. Check the Identification and Reconciliation Engine (IRE) rules for the required identifying attributes.
  3. Ask for missing data.
  4. Check for duplicates.
  5. Create the CI.

  Typical use: physical and OT assets that discovery cannot see.
- **Duplicate CI remediation** — [AI]
  - ServiceNow *Duplicate CI Remediator* agentic workflow: covers the whole de-duplication process (from IRE de-duplication tasks) and shows its reasoning at each step, so a CMDB admin can review and change the recommended actions before applying them.
  - ServiceNow *Manage duplicate CIs* skill: lists classes that have duplicates, helps create, assign and run de-duplication templates, previews the remediation result before a template is applied, and helps find the root cause (usually a weak identification rule or a second discovery source).
  - Feedback on each generated response is stored in the agentic AI logs.
- **CI summarization** — Summarizes a CI's discovery data, ownership, open incidents, alerts and problems, upcoming changes, vulnerabilities, and the service instances it belongs to. Started from the CI form, a workspace page or a list; used in incident, change and event work. [ServiceNow] [AI]
- **CI data-quality agent** — BMC HelixGPT *CMDB Governor* finds CI data-quality issues and recommends corrections with a root-cause analysis. BMC *Service Collaborator* also analyzes CI data-quality issues for agents. [AI]
- **CMDB governance advisor** — An agentic workflow that walks data admins and data owners through improving accuracy, completeness and health. *Summarize CMDB readiness* turns the CMDB Success Advisor dashboards (HAM, Data Foundations), with their filters, into findings and remediation steps; regenerate after changing filters. [ServiceNow] [AI]
- **Integration and import diagnosis** — *Service Graph Connector diagnosis* summarizes errors in third-party import sets and recommends fixes. AI agents for Discovery, Service Mapping, MID Server and Agent Client Collector shipped in the Now Assist for ITOM store app (2.3.0, September 2025; 2.4.5, December 2025); their detailed behaviour was not documented in the notes read. [ServiceNow] [AI]
- **Health KPIs (non-AI base)** — Correctness (duplicates, orphans, staleness), completeness (required and recommended fields), compliance (audits against certified templates). The AI features above sit on these deterministic metrics. [ServiceNow CMDB Health; BMC Helix CMDB data quality dashboards]
- **Relationship suggestions** — No vendor documents ML that proposes missing CI relationships as a CMDB feature. Relationships come from discovery and service mapping (pattern-, traffic- and tag-based). ServiceNow infers relationships only to build queries. This is an open opportunity (recipe below). [AI] (gap)
- **Topology for AI grounding** — CMDB dependency graphs feed change blast radius, alert impact and root-cause agents. Examples: the ServiceNow AIOps AI Specialist "investigates probable cause using CMDB and topology"; BMC Helix AIOps situations; the Dynatrace Smartscape-based causal engine. [AI]

### Implementation notes
- **CI de-duplication (record linkage):**
  - *Blocking keys:* serial number, normalized MAC address, cloud resource ID, BIOS/SMBIOS UUID, `hostname + DNS domain`.
  - *Pair features:* exact or fuzzy comparisons (Jaro–Winkler on names, IP overlap, same model, same location, last-discovered gap).
  - *Scoring:* Fellegi–Sunter probabilistic linkage, or logistic regression trained on admin merge decisions.
  - *Survivor selection:* deterministic, using data-source precedence (reconciliation rules) and recency. The merge moves relationships, tasks, audit history and attachments.
  - The LLM only *explains* the proposed merge and the probable root cause, such as "two discovery sources with different identification rules". Preview first, then a reversible merge with an undo journal.
- **Relationship suggestion recipe:**
  1. *Observed:* connection data from discovery (listening and established sockets, load-balancer pools, DNS CNAMEs) → "connects to" / "runs on".
  2. *Co-occurrence:* CIs that appear together in incidents, alerts or changes within short windows. Use association rules with lift > 3 and support ≥ 5 → suggest "depends on".
  3. *Config parsing:* an LLM extracts endpoints from connection strings and config files fetched by discovery.
  4. Present suggestions to the CI owner with the evidence attached. Accepted edges get `source = ai_suggested`.
- **NL → CMDB query:**
  - Give the LLM a compact schema card for the top-k classes (chosen by embedding similarity to the question): class, key attributes, allowed relationship types.
  - It returns a *structured query AST*, not SQL: `{class, filters[], traverse[{rel_type, direction, class}], fields[]}`.
  - Validate the AST against the schema, run it through the normal ACL-enforcing query layer, and show the generated query so users learn it.
  - Reject queries that would scan the whole graph without filters.
- **CI summary:** assemble the facts deterministically (counts, open-task list, next change window, last discovery date). The LLM writes prose only from those facts, with links on each item. Cache per CI and invalidate when related tasks change.
- **Conversational CI creation:** generate the slot schema from the identification rule and class mandatory fields. Run the IRE "identify" step *before* create; on a match, offer "update the existing CI" instead.

## Module: itam

### Features
- **Contract entitlement extraction** — Upload a publisher contract; the system reads license counts, product names, metrics, unit costs and similar fields and creates entitlements. [AI]
  - ServiceNow uses DocIntel; the skill is active by default in the Software Asset Workspace and is activated in the AI admin console by a user with the AI contract-admin role. Optional participation in the SAM Content Service improves recognition over time.
  - A separate *manage contract repository* agentic workflow extracts metadata and obligations from signed contracts; reviewers accept or reject each extracted obligation.
  - Flexera One ITAM: AI contract and entitlement ingestion from contracts, invoices, POs and quotes.
- **Software spend detection** — Finds software purchases in imported financial transactions, extracts publisher and product, and matches them to the content library. [ServiceNow Otto for SAM 11.0.0, September 2026] [AI]
- **Publisher and product normalization** — [AI]
  - ServiceNow Otto for SAM 13.0.0 (November 2026) searches and reviews candidate matches in the SAM Content Library during entitlement import.
  - Flexera Technopedia is an AI-assisted catalog for normalizing and enriching inventory. Flexera claims 4.9M+ products identified and markets "98% coverage in under 10 minutes vs 35% in 18 hours" for ServiceNow (vendor comparison claim).
  - Ivanti Neurons and ManageEngine normalize against their own catalogs (detail unverified).
- **Hardware model normalization** — A daily job normalizes manufacturer, product, model and device type for hardware and consumable models. It never adds, removes or merges models, and never changes the original fields (Model Name, Manufacturer, Model Number). An OT variant exists. [ServiceNow HAM, Australia] [AI/ML-assisted]
- **License compliance summaries and recommended actions** — Publisher summarization (estate and license position), product compliance and optimization summaries, recommended actions to reduce compliance risk, and publisher compliance insights. [ServiceNow Now Assist for SAM 1.0–3.3, 2025] [AI]
- **Reclamation intelligence** — Reclamation rule recommendations (rules that widen reclamation coverage), removal candidate evaluation, and the *Evaluate Software Reclamation* agent (October 2026), which evaluates subscription removal candidates per integration profile and software model from Reclamation Summary data. [ServiceNow] [AI]
- **SaaS license management AI** — *AI user resolution* matches SaaS subscription accounts to people. *SaaS connection error resolution* diagnoses integration errors during setup or live sync. [ServiceNow] [AI]
- **Fulfilment agents** — [ServiceNow] [AI]
  - *Microsoft 365 License Assignment* agent (March 2026): evaluates M365 catalog requests, checks license availability and assigns the license in the M365 Admin Center without manual steps.
  - Agentic software sourcing, Software Entitlement Allocation, and Purchase Order Creation.
  - HAM *Help manage hardware asset requests* agentic workflow: sourcing, transfer order, purchase order and repair process agents; `procurement_user` role.
- **Asset summaries and insights** — HAM asset analysis summaries (Yokohama Patch 13); *Generate asset insights* (Australia). [ServiceNow] [AI]
- **Import assistance** — AI suggests fixes when the standard Excel entitlement template fails to import (8.0.1, June 2026). AI Lens maps spreadsheet columns to fields, choices and references (see Module: platform). [ServiceNow] [AI]
- **Model choice per use case** — From 9.0.0 (July 2026) SAM picks the best third-party LLM per use case by default instead of Now LLM. 12.0.0 added Gemma 4 26B A4B IT and Gemini 3.5 Flash. [ServiceNow] [AI]
- **Licensing gates** — Now Assist / Otto for SAM needs SAM Pro plus or Enterprise plus. Now Assist for HAM needs HAM Pro plus. [ServiceNow]

### Implementation notes
- **Normalization pipeline** (software and hardware):
  1. Exact and alias lookup in the catalog, including a customer-specific alias table learned from past approvals.
  2. Rule and regex parsing of version, edition and architecture.
  3. Embedding kNN (k = 10) over catalog entries (`publisher | product | edition`).
  4. LLM adjudication over the top 5 with a JSON answer `{catalog_id|null, confidence, reason}`.
  5. Above 0.95, auto-map. Otherwise send to a review queue, and every human decision feeds the alias table.

  Store normalized values in separate fields; never overwrite discovered raw values.
- **Contract extraction:**
  - Pipeline: OCR or PDF text, then page segmentation, then an LLM with a strict JSON schema: `publisher, product, sku, license_metric, quantity, term_start, term_end, unit_cost, currency, true_up, territory, use_rights[], obligations[]`.
  - Each field carries `{page, quote}` evidence.
  - Show the result side by side with highlights for human verification. Map products through the normalization pipeline.
  - License math (effective license position, true-up exposure) stays deterministic code, never LLM arithmetic.
- **Reclamation:**
  - Candidates: no usage in N days (90 by default; per-publisher overrides), duplicate installs, downgrade candidates where premium features are unused.
  - Rank by savings × confidence. An LLM writes the user notification and the summary for the asset manager.
  - Execution goes through the approval-gated uninstall or unassign workflow.
- **SaaS user resolution:** exact email → normalized email (aliases, plus-addressing) → UPN and IdP identifiers → fuzzy name plus domain → LLM tie-break with evidence. Never merge on name alone.
- **Spend detection:** first a cheap classifier (TF-IDF over supplier plus description with logistic regression, trained on accepted labels) flags software lines; then the LLM extracts publisher, product and term only from flagged lines, which keeps cost low.

## Module: slm

### Features
- **SLA-aware escalation** — The ServiceNow *Escalation* agentic workflow weighs remaining SLA time, urgency, priority and impact, and labels the record Critical, High or Medium with a reason (see Module: incident). [AI]
- **Threshold-based breach warnings (non-ML baseline)** — Most tools warn on time remaining rather than a predicted probability. [rules]
  - Zendesk automations and triggers on "Hours until next SLA breach" (SLA policies need Suite Professional or higher).
  - ManageEngine proactive escalation rules.
  - ServiceNow SLA stages and percentage-based workflow timers.
- **SLA breach prediction (ML)** — Some third-party write-ups describe ServiceNow Predictive Intelligence models predicting breach risk from incident and SLA history (unverified as an out-of-box feature). In this pass no vendor documented a native per-ticket breach-probability model. BMC *intelligent service prediction* is a classifier trained on closed incidents that predicts the *service* an incoming incident disrupts, not the breach risk. This is an opportunity to lead the market (recipe below). [AI] (gap)
- **SLA analytics insights** — Freshservice Freddy AI Insights (Enterprise): [AI]
  - Proactive insight cards on *Resolution SLA Violated Tickets* (by category and by agent) and *First Response SLA Violated Tickets*, alongside volume, resolution and response times and survey score.
  - Insight types: Majority, Outliers, Trend change (spike/fall), Longest increase/decrease (weekly only), Recent change, Overall trend.
  - Each insight has a criticality colour, a trend chart, and a root-cause tree map titled "Leading causes could be" with a natural-language summary.
  - Refresh: daily (30-day lookback), weekly (12 weeks; needs 6 weeks of data), monthly (1 year; needs 6 months).
  - Governed by a *Freddy Insights* permission.
- **SLA context in generated text** — The ServiceNow incident summary includes a Service Level Agreement section. Major incident email generation reads Task SLA fields: target, stage, actual and business time left, breached flag, pause time. [AI]
- **Experience signals (XLA)** — Sentiment and sentiment trend per record (ServiceNow, Freshservice, Zendesk, JSM; see Module: incident) feed experience-level reporting. [AI]

### Implementation notes
- **Breach-probability model** (per SLA definition and priority):
  - *Method:* survival analysis on time-to-meet. Start with Kaplan–Meier curves stratified by assignment group × priority; then fit a gradient-boosted accelerated-failure-time model or a Cox model.
  - *Features:* elapsed business time, pause time, category, service, CI tier, group backlog and WIP at this moment, assignee load, reassignment count, time since the last customer reply, time of day and week, holiday flag, and whether a similar incident is linked.
  - *Score:* `P(breach) = P(T_remaining > time_left)`, recomputed every 5–15 minutes for active SLAs; this is cheap.
  - *Calibration:* isotonic regression; publish a reliability diagram in the admin console.
  - *Actions:* above a threshold (e.g. 0.7) with less than X hours left, raise an "at risk" badge, notify the group lead, and suggest reassignment to an available agent with matching skills.
- **Explainability:** show the top contributing features, e.g. "group backlog 2.3× normal; 3 reassignments", and let the LLM write one sentence from those features only.
- **Target recommendation:** propose SLA targets from historical percentiles (P80/P90 resolution time per priority and service) and simulate how many breaches each candidate target would have caused last quarter.
- **Service review packs:** compute the metrics deterministically, then have the LLM write the narrative: what changed, why (drivers from the insight engine), and the actions agreed. Every number must come from the provided table.

## Module: service_portfolio

### Features
- **Service and offering inference on records** — The ServiceNow triage agent sets service, service offering and CI. BMC *intelligent service prediction* classifies incoming incidents to the services they are likely to disrupt. Atlassian lists "service-based AI routing" on its roadmap for Q4 2026. [AI]
- **Portfolio optimization from demand** — BMC *Service Optimizer* agent finds high-impact optimization opportunities in conversation data. The ServiceNow AIOps LEAP feature groups large sets of automation opportunities into sub-groups with GenAI. [AI]
- **Catalog and service generation** — BMC *Catalog Curator* generates catalog services from admin input. ServiceNow Catalog Item Generation; JSM AI-generated request types (see Module: request). [AI]
- **Service health narrative** — ServiceNow Service Observability dashboard summarization adds service-health analysis to AI summaries of alert-related services. [AI]

### Implementation notes
- **Service classifier:** the label is the service on resolved records; the features are text embeddings, the caller's department and location, and the CI. Use kNN over embeddings with a logistic-regression head, and abstain below a confidence threshold. Retrain monthly. Report per-service precision so service owners trust it.
- **Portfolio insights:**
  - Cluster request and incident text per service each quarter.
  - Find (a) demand with no matching catalog item (a catalog gap), (b) catalog items with almost no use (retire candidates), and (c) services with high incident-to-request ratios.
  - The LLM drafts a portfolio review memo that cites the clusters.

## Module: event

### Features
- **Alert correlation and grouping** — [AI]
  - *ServiceNow Event Management / AIOps:*
    - Automated (ML) alert groups, with *AI analysis for automated alert groups* (2.6.0, March 2026).
    - *Proactive grouping recommendations* for incoming alerts, refreshed every 5 minutes (2.6.16).
    - A *Text-to-Configuration* agent turns a plain-language grouping rule into an inactive rule preview that can be simulated, saved or activated.
  - *JSM (Rovo alert grouping):* clusters similar alerts within a rolling 24-hour window into a durable alert group. It works on JSM-native alerts only, and the group can be turned into an incident with AI-generated details. Atlassian sources disagree on the plan (Premium vs Enterprise). It is not available on BYOK-encrypted sites. Atlassian claims a 59% cut in triage time.
  - *PagerDuty:*
    - *Intelligent Alert Grouping* (ML on past incidents and responder actions; rolling window from 5 minutes to 1 hour).
    - *Content-Based* grouping (exact match on chosen fields).
    - *Time-Based* grouping (2 minutes to 24 hours, or until resolved).
    - *Global Alert Grouping* across services.
  - *Others:* BigPanda correlation patterns over its IT Knowledge Graph; Splunk ITSI episodes through aggregation policies (with "Event iQ" AI correlation, per a third-party source); BMC Helix AIOps ML-based *situations*.
- **Noise reduction** — [AI]
  - ServiceNow *Noise alert classification* (2.6.0): an LLM classifier reviews same-alert groups matched by CI or node and metric name, and labels them *noise* or *requires operator action*. The AIOps AI Specialist closes noise alerts.
  - PagerDuty *Auto-Pause Incident Notifications*: ML spots transient alerts that usually clear on their own, pauses notifications for a period set per service, and suggests a pause length from history. Alerts a responder resolves by hand are never classed as transient.
- **Alert and situation explanation** — [AI]
  - ServiceNow: *Alert Assist* (3.8.1); an *AI Insights* card on the alert form; rich HTML insights from the autonomous operator workflow; expanded alert explanations and auto-closure reasoning (2.9.4).
  - BMC: *Situation Analyzer* summarizes ML-based situations in plain language. *Ask HelixGPT* answers set questions about impact, owning team, related changes and recurrence (controlled availability).
  - JSM: create an incident from alerts with AI-written details.
- **Probable root cause** — [AI]
  - ServiceNow *AIOps AI Specialist* (limited availability June 2026, GA in 2.10.0, November 2026): triages alerts, investigates probable cause using the CMDB and topology, hands off to remediation, and closes noise.
  - BMC:
    - *Root Cause Finder* (formerly Root Cause Analyzer) analyzes logs, events and changes in the service context and gives a hypothesis with reasoning.
    - *Best Action Planner* correlates situation data with logs and related ITSM changes, writes a root-cause summary into the situation, and uses a change tool to judge whether a recent change is the likely cause.
    - The 26.2 *recommendation planner* uses Change, Log and Code tools and needs model HelixGPT-v7.4 or later.
    - *Deep RCA* is in controlled availability (January 2026).
  - PagerDuty: *Probable Origin* (the most likely originating service), *Past Incidents*, *Related Incidents*, *Recent Changes*, *Outlier Incident*.
  - BigPanda: root-cause changes, and an AI Incident Assistant that finds historically similar incidents and their resolution steps.
  - Dynatrace: deterministic causal AI over the live topology.
  - Datadog *Bits Investigation* (formerly Bits AI SRE; GA):
    - Starts investigating as soon as an alert fires, typically finishing in 3–4 minutes.
    - An *Agent Trace* view shows its reasoning.
    - Teams give it troubleshooting guidance in a `bits.md` file.
    - Action Catalog actions trigger and list investigations, and it can start remediation.
  - Xurrent Sera *AI SRE teammate* (2026-10-15).
- **Impact analysis** — ServiceNow *Analyze Alert Impact* workflow (2.3.0) and the impact assessment step in the AIOps AI Specialist. BMC Ask HelixGPT (impact, owning team). BMC Change Risk Advisor flags risky changes using operations and service-management data. [AI]
- **Autonomous alert handling and remediation** — [AI]
  - ServiceNow:
    - The *Manage alerts autonomously* agentic workflow (2.5.0, January 2026) covers triage, impact and root-cause investigation.
    - The *Remediation Agent* finds and runs the matching remediation subflow.
    - The *Alert Verification* agent closes alerts using related incidents and KB articles (2.9.4).
    - *AI resolution attribution* records "Closed by AI" to measure the automation rate.
    - Alerts handled by AI go back to the original operator. Alerts an operator reopens skip noise classification and get a full investigation.
  - PagerDuty Paige SRE agent: remediation waits for approval unless the team opts out.
  - BMC *Automation Advisor*: runs triage and remediation actions in connected third-party automation tools from chat.
  - Datadog Bits: remediation inside the platform.
- **Observability-tool analysis agents** — ServiceNow *Datadog analysis* and *Google Cloud Observability analysis* AI agents (2.5.0). The *ITOM MCP Server* (2.6.12, May 2026; Zurich Patch 9) lets outside AI tools retrieve, analyze and investigate alerts. [AI]
- **Anomaly detection and adaptive thresholds** — [AI/ML]
  - Splunk ITSI:
    - Adaptive thresholds computed by ML from each KPI's observed behaviour; per-entity thresholds since 4.21.
    - ML-assisted threshold recommendations since 4.18.
    - Up to 100,000 KPIs since 4.20.
    - Service health scores weighted by KPI importance.
  - Datadog Watchdog stories; Dynatrace auto-adaptive baselines; BMC *Adaptive Data Collector*, which collects context-aware diagnostics only when needed instead of continuously.
  - ServiceNow Health Log Analytics and Metric Intelligence (2026 naming unverified).
- **Natural-language configuration of operations tooling** — [AI]
  - ServiceNow: *Text to Configuration Agent* for AIOps settings (2.6.16); the *Integration Management Agent*, which sets up and manages top pull connectors in conversation (2.9.4); integration installs from the launchpad with Otto.
  - BMC *Custom Data Integrator*: customizes views from prompts.
- **Knowledge for operations** — ServiceNow *AIOps LEAP* (Learning-Enhanced Automation Platform): [AI]
  - Writes KB articles with command snippets and playbooks through guided chat.
  - Groups large sets of automation opportunities into sub-groups.
  - Writes resolution steps from web sources and rewrites them when new data sources are enabled.
  - Advanced KB search and summarization during alert investigation.
- **On-call and swarming assistants** — [AI]
  - PagerDuty: *Scribe* agent (call and chat transcription and summaries), *Shift* agent (schedule conflicts), *Insights* agent.
  - BMC *Ops Swarmer* in Teams: summaries, timelines, on-call lookup through xMatters or PagerDuty.
  - Atlassian *Ops Expert* (formerly Rovo Ops): investigates, suggests causes, drafts stakeholder updates and PIRs.
- **Model providers for AIOps agents** — ServiceNow made Azure OpenAI the default provider for ITOM skills and agents in 2.8.0 (July 2026), replacing Now LLM. AWS-hosted Claude was added as an agent provider in 2.8.0 and 2.9.2. BMC AIOps runs on fine-tuned HelixGPT models (v7.4 from February 2026). [AI]

### Implementation notes
- **Pipeline:**
  1. **Ingest.**
  2. **Normalize** to `{source, node, ci_ref, metric, check, severity, message, tags, first_seen, last_seen}`.
  3. **Deduplicate** by fingerprint = hash(source, node, metric or check).
  4. **Enrich:** bind to a CI by hostname, IP or cloud ID; then service; then owner group; then changes on the CI or its upstream in the last 24 hours.
  5. **Noise classification.**
  6. **Correlation.**
  7. **Incident creation or update.**
- **Correlation score** for an alert and an open group, a weighted sum of:
  - (a) same CI or service within the window (a rule);
  - (b) topological distance ≤ k hops in the dependency graph;
  - (c) learned co-occurrence of alert *types* (PMI over 5-minute buckets in 90 days of history);
  - (d) text similarity of *templated* messages (mine templates with Drain, mask numbers and IDs, then take embedding cosine);
  - (e) feedback priors from human merge and split actions.

  Join the group when the score is above a threshold. Groups are durable (rolling 24 hours, as in JSM) and humans can split or merge them, which becomes training data.
- **Noise model:**
  - Features: flap count, auto-clear rate, median time to auto-clear, historical "acted-upon" rate (the alert led to an incident, a ticket comment or a runbook), hour of week.
  - A GBM or logistic regression scores known alert types; an LLM classifies new types from their text. Never auto-close alerts on tier-1 services without a second signal.
  - Suggested auto-pause = P90 of time-to-auto-clear for transient alerts on that service (PagerDuty pattern).
- **Root-cause ranking (deterministic first, LLM narrates):**
  - Candidates: alerts in the group, changes and deployments on the affected CIs and their upstream dependencies in the last 24 hours, log-template spikes, recent config drift.
  - Score: temporal precedence + upstream position in the topology + change proximity + historical co-occurrence with this symptom.
  - The LLM receives the top 5 candidates with their evidence and writes `{hypothesis, evidence_refs[], confidence, next_checks[]}` (Root Cause Finder style).
  - When evidence is thin it must say "insufficient evidence", never invent a cause.
- **Anomaly detection:**
  - *Seasonal series:* STL decomposition, then a robust z-score (median absolute deviation) on the residual.
  - *Forecasts with intervals:* Holt-Winters (triple exponential smoothing).
  - *Thousands of entities:* per-entity hour-of-week quantile thresholds (adaptive-threshold style).
  - *Change points:* CUSUM or Bayesian online change-point detection.
  - *Logs:* Drain templates plus a Poisson spike test per template.
- **Autonomous remediation:**
  - A runbook registry records preconditions, the target CI class, blast radius, approval policy (approve-by-default unless the team opts out), and a dry-run and post-check.
  - Write `closed_by_ai` and the agent run ID on every AI action. Hand the alert back to the original owner after AI processing.
  - A reopened alert is always fully investigated. ServiceNow 2.9.2 does both.

## Module: continuity

### Features
- **Capacity forecasting and time-to-exhaustion** — ML forecasting of utilisation (disk, CPU, memory, licences, queue depth) with prediction intervals. [AI/ML]
  - Vendors: Splunk ITSI predictive analytics and adaptive thresholds; Dynatrace forecasting; BMC Helix capacity optimization; ManageEngine OpManager forecast reports; ServiceNow Metric Intelligence. Product names and 2026 detail unverified.
- **Reliability and SLO gap detection** — The ServiceNow *Reliability Domain Agent* (AI agents for SLO 2.0.3) finds SLO and synthetic-monitoring gaps from post-incident data and creates reliability tasks. [AI]
- **Change-driven availability risk** — Atlassian Prevention Center (EAP) with *Change Pre-risk Assessment*. BigPanda predicts the potential impact of proposed changes. The BMC *Change Risk Advisor* uses operations data. [AI]
- **Service health prediction** — Splunk ITSI service health scores from weighted KPIs. Predicting a service's health score ahead of time is an ITSI predictive-analytics capability (detail unverified for 2026). [AI/ML]
- **Continuity planning documents** — Drafting business impact analysis (BIA) questionnaires, continuity and disaster-recovery plans, and test reports with generative AI is offered by GRC/BCM vendors; ServiceNow BCM AI skills are unverified in this pass. Treat it as a generic LLM document recipe. [AI] (unverified)

### Implementation notes
- **Forecasting:**
  - Default to Holt-Winters (additive seasonality, daily and weekly periods) per metric. Use linear or robust regression for monotonic growth (disks).
  - Time-to-exhaustion = first time the upper 80% prediction interval crosses capacity.
  - Raise a capacity risk when that is less than the procurement lead time.
  - Back-test monthly and keep MAPE per series. Fall back to a seasonal-naive forecast when Holt-Winters back-tests worse.
- **Availability risk score per service:** recent incident rate (exponentially weighted), open problems without workarounds, planned changes in the next 7 days weighted by their risk, single points of failure from the CMDB (CIs with no redundancy relationship), and capacity risks. An LLM writes a weekly "continuity watchlist" from these facts.
- **Plan drafting:**
  - A template-driven LLM fills BIA and DR plan sections from CMDB facts (service → CIs → hosting → recovery tier), contacts and runbooks.
  - Each section cites its source records; unknowns are left as explicit TODOs, never guessed.
  - Owners must attest before the plan is published.

## Module: security

### Features
- **Security incident summarization** — ServiceNow Now Assist for Security Incident Response (SIR). [AI]
  - Works on security incidents in any state except Draft; inputs are configured on the Security Incident table (`sn_si_incident`).
  - Uses only material in the user's *domain*.
  - July 2026 enhancement: the summary follows the chronological order of events and gives more weight to recent activity.
  - Skills can be customized, and further SIR skills include recommended actions and quality assessment.
- **SecOps AI agents** — ServiceNow SIR agents on by default (Australia): [AI]
  - EDR AI agent.
  - Exchange Online integration-handling agent.
  - Observable analysis agent (enriches and judges IOCs).
  - Security incident resolution agents, including *Security Incident Resolver v2 with AI Runbooks* (4.3.5, April 2026).
- **Vulnerability management AI** — [AI]
  - ServiceNow Now Assist for Vulnerability Response:
    - Summarization, limited to the user's domain.
    - *Suggest preferred vulnerability solutions*: reasons over third-party solutions for vulnerabilities on the analyst's assets.
    - The *Analyze vulnerability remediation status* agentic workflow breaks remediation data down by severity, assignment group, CI and vulnerability for monthly SLA compliance reviews.
    - Agents for vulnerability exposure analysis, CISA vulnerability analysis and watch-topic creation.
  - BMC HelixGPT *Vulnerability Classification*: categorizes ingested vulnerabilities.
  - Ivanti Neurons for Discovery joins the software estate with exposure management (risk insights).
- **GRC / IRM AI** — ServiceNow Now Assist for IRM (app v20.1.1; skills on by default per 2026 notes). [AI]
  - *Issue summarization* from description, activity log and remediation tasks, in Risk Workspace, Core UI and Compliance Workspace.
  - *Risk assessment summarization* from inherent, residual and target risk and control effectiveness.
  - Recommendations for similar control objectives; *control objective rationalization*, which removes redundant objectives; a *common control objective creation* skill.
  - The *GRC issue resolution* workflow in the panel.
  - *Regulatory alert summarization*, and recommendations for the citations, control objectives, controls and policies a regulatory alert affects (from 19.0.x).
  - *Generate regulatory action plans* agentic workflow (2026-01-20), a regulatory change task-planning agent, and a *risk suggestion* AI agent.
  - A dedicated policy-*generation* skill was not found.
- **AI Risk and Compliance** — Risk assessment of the company's own AI systems (inventory, frameworks), tied to AI Control Tower. See Module: ai. [ServiceNow] [AI]
- **Third-party risk** — See Module: supplier.
- **Security of the AI layer itself** — Prompt-injection detection, PII masking and agent identity. See Module: ai and Access control. [AI]

### Implementation notes
- **SIR summary:** retrieval is strictly domain- and ACL-scoped, the same as for any record. The prompt orders events by time and asks for current status first, then the timeline, IOCs, affected assets, actions taken, open questions, and the next recommended steps. Indicators are rendered from structured fields, never from LLM memory.
- **Observable analysis agent:**
  - Tools: threat-intelligence lookups (hash, IP, domain reputation), EDR process tree, mail-trace queries.
  - Output: `{verdict: malicious|suspicious|benign|unknown, confidence, evidence[]}`.
  - Containment actions (isolate host, disable account, purge mail) always need human approval and are logged immutably.
- **Vulnerability prioritization:** deterministic first.
  - `risk = CVSS_base × f(EPSS) × KEV_flag_boost × asset_criticality(service tier from CMDB) × exposure(internet-facing) × (1 − compensating_control_factor)`.
  - Group vulnerable items into remediation tasks by *solution* (one patch fixes many CVEs) and owner group.
  - Remediation SLAs follow the risk band. The LLM only explains and drafts the owner notification.
- **Solution suggestion:** map CVE to vendor advisory to fixed version with deterministic version comparison. The LLM summarizes the advisory and the steps and must cite the advisory URL.
- **Regulatory change mapping:**
  1. Embed regulation clauses (citations) and the internal control and policy library.
  2. For each changed clause, retrieve the top-k controls and policies.
  3. The LLM classifies the impact (none, minor, material) with a rationale.
  4. Generate an action plan of tasks with owners, which a compliance officer approves.
- **Control rationalization:** cluster control objectives by embedding similarity (≥ 0.88 cosine). The LLM proposes one common objective plus the mapping to every original citation. Never delete; deprecate with a crosswalk.

## Module: supplier

### Features
- **Third-party risk issue summarization** — ServiceNow Now Assist for TPRM. [AI]
  - Summarizes a third-party risk issue (description, activity log, remediation tasks) in every state: New, Analyze, Review, Finalize, Closed.
  - Needs the GRC Common GenAI and Third-party Risk Due Diligence plugins and assessor roles.
- **Issue recommendation from assessment responses** — ServiceNow TPRM: proposes issues from supplier questionnaire answers (Smart Assessment Engine assessments only). An issue is created only after a user confirms it. [AI]
- **Contract and obligation extraction** — ServiceNow contract repository agentic workflow (metadata and obligations, reviewer accepts or rejects); Flexera contract ingestion (see Module: itam). [AI]
- **Supplier performance narrative** — Not found as a packaged feature; recipe below. [AI] (gap)

### Implementation notes
- **Questionnaire analysis:**
  - For each answer, compare it with the control expectation via a retrieved rubric. The LLM labels the answer *meets*, *partial*, *gap* or *needs evidence* and cites the answer.
  - Gaps become *proposed* issues that require confirmation, as ServiceNow does.
  - Evidence documents are processed with the contract-extraction pipeline (page-cited fields).
- **Supplier scorecard:** compute deterministically the SLA attainment of supplier-dependent services, incidents caused by vendor CIs, delivery lead times and invoice disputes. The LLM writes the quarterly business review narrative only from those numbers.

## Module: financial

### Features
- **Software spend detection from transactions** — ServiceNow Otto for SAM 11.0.0 (see Module: itam). [AI]
- **Licence cost optimization summaries** — Reclamation and right-sizing recommendations with savings (ServiceNow SAM; Flexera). [AI]
- **Cloud and FinOps automation** — Flexera reportedly acquired ProsperOps (agentic FinOps commitment management) in January 2026 (third-party source, unverified). Cloud cost anomaly detection is standard in FinOps tools. [AI/ML]
- **Cost of AI itself** — Token, credit and session metering and ROI dashboards. See Module: ai. [AI]

### Implementation notes
- **Cost anomaly detection:** per cost centre and service, apply STL plus a robust z-score to daily spend; alert when the residual is more than 3.5 MADs and the absolute delta exceeds a currency floor. The LLM writes the explanation from the top contributing line items.
- **Chargeback narratives:** allocate cost with deterministic rules (CI → service → cost centre). The LLM only summarizes month-over-month drivers.

## Module: project

### Features
- **AI project status reports** — ServiceNow Now Assist for SPM (Project Workspace, Australia). [AI]
  - Prefills project health, an executive summary and the supporting rationale from weekly project data. Users can edit and export the report, and *Summarize* produces a short version.
  - Needs the `it_project_manager` role and the project status generation skill.
  - An AI-generated status report cannot be duplicated.
- **Demand summarization** — Concise summaries of demands. *Demand Management Automation* (controlled availability) uses AI specialists to validate demands and convert them into projects or work. [ServiceNow SPM] [AI]
- **Project monitoring agent** — *Monitor Project Tasks* AI agents watch project operations autonomously. [ServiceNow SPM] [AI]
- **SPM over MCP** — The MCP for SPM app (v1.8.0, with Now Assist for SPM v9.11.0) gives external AI clients tools such as *Get AI Status Report* (red/amber/green across resources, cost, schedule and scope) and *Identify Project Risks* (detects RIDAC risks and saves them as AI drafts). [ServiceNow] [AI]
- **Other vendors** — Ivanti PPM sends project at-risk and off-track notifications (rule-based, 2026.1). Atlassian Rovo summarizes Jira work and drafts status updates (general Rovo capability). [AI/rules]

### Implementation notes
- **Status report:**
  - Facts: schedule variance from baseline, cost actuals vs plan, resource over-allocation, open RIDAC (risks, issues, decisions, actions, changes) items, and milestones in the next 2 weeks.
  - RAG colour comes from deterministic thresholds. The LLM drafts the executive summary and rationale and must reference those facts.
  - Store the AI draft separately from the published report.
- **Risk identification:** scan task comments and status notes weekly. The LLM extracts candidate risks as `{title, cause, impact, probability, evidence_ref}`, saved as *AI draft* risks for the PM to confirm (ServiceNow pattern).

## Module: portal

### Features
- **LLM virtual agent / AI agent for employees** — Answers questions from knowledge, captures requests without forms, runs actions, and hands off to humans. [AI]
  - ServiceNow Now Assist in Virtual Agent:
    - LLM topic discovery and conversational catalog ordering (see Module: request). LLM topics need an LLM assistant assigned to the portal.
    - Generative answers from AI Search (Now Assist in AI Search 16.1.4, May 2026).
    - EmployeeWorks (launched 2026-02-26) and Moveworks are being merged into the *Otto* assistant.
  - JSM virtual service agent:
    - Channels: portal and help center, Slack, Microsoft Teams, email, embeddable widget (Premium / Enterprise).
    - Every message is first matched to admin-built *intents*, deterministic flows that collect information, run conditions and actions, and raise requests. Only if no intent matches does it try *AI answers* over the linked knowledge spaces.
    - Request Resolver adds autonomous resolution.
  - Freshservice Freddy AI Agent (Enterprise):
    - Channels: support portal, Slack and Teams (through ServiceBot), Email Bot.
    - Sources: internal KB, SharePoint, Google Drive, Confluence.
    - Multi-turn context, formless intent capture, actionable response summaries, citations and grounding, image support, connection to Microsoft 365 Copilot.
    - Metering: 1,200 sessions per license per year, a session being one unique user in 24 hours. The legacy virtual agent was deprecated on 2025-05-21.
  - Ivanti Agentic AI (2026.1; SaaS-only add-on):
    - RAG knowledge search and deflection.
    - *Incident Agent* creates incidents from natural language; *Service Request Agent* picks the request template and submits it.
    - A *Q&A service* answers questions such as "my active incidents", "last week's incidents" or the status of a given ID.
    - Configurable live-agent handoff.
  - InvGate *Virtual Service Agent*:
    - Channels: portal, Slack (GA), Microsoft Teams, WhatsApp, in-app.
    - Sources: KB text, DOC/DOCX/PDF attachments, and SharePoint libraries and Site Pages synced every 3 hours *respecting SharePoint group permissions*.
    - Creates and tracks requests and handles approvals. One knowledge base and one setup serve every channel.
  - Zendesk AI agents (employee service and CX):
    - Separate agents for messaging, email and voice; 80 languages for text, 53 for voice.
    - *Procedures* are written in natural language.
    - Agentic email AI agents became GA on 2026-04-20.
    - Former "Advanced" capabilities (agentic reasoning, multi-step procedures, API integrations) were folded into Suite and Support plans on 2026-05-11. Legacy agent types retire at the end of 2026 (sources disagree on the exact dates).
  - TOPdesk *Robin*: an AI chatbot on my.topdesk.com built with partner Ebbot over the customer's own knowledge sources (January 2026), extended into an "AI teammate" (September 2026). Plus Answer Assistant and AI Search.
  - Others: SysAid AI Chatbot and AI Emailbot; HaloITSM AI agents; Moveworks AI Assistant; Aisera; Atomicwork Atom / AI Coworkers.
- **Generative search with citations** — Search results topped by a synthesized answer that cites readable sources. [AI]
  - ServiceNow AI Search Q&A (*Genius Results*; RAG with small-to-big chunking and hybrid retrieval, per the Overview).
  - JSM AI answers; Zendesk generative search; TOPdesk AI Search.
  - Ivanti *Improved Search* (2026.1, needs an AI package): partial-word matching and related terms ("PC" also finds computer, laptop, desktop), with semantic search in preview.
  - Moveworks Enterprise Search with connectors; for example, the January 2026 release added 10 next-generation connectors and February 2026 decoupled indexing from live search for SharePoint Online.
- **Enterprise knowledge connectors** — Answers draw on SharePoint, Confluence, Google Drive and more (Freshservice, InvGate, Moveworks, Atlassian Rovo connectors, ServiceNow external content connectors, Aisera). The access-control question each must answer is covered in Access control. [AI]
- **Voice agents** — [AI]
  - ServiceNow *AI Voice Agents* (Now Assist for Voice 4.1.2, April 2026). In CSM (Q1 2026) there are two prebuilt voice agents, case status and case creation. A third-party source says voice is in the "Advanced" AI tier (unverified).
  - Zendesk voice AI agents (53 languages).
  - ServiceNow Yokohama added voice *input* in the AI panel (see Module: platform).
- **Chat-platform and assistant channels** — Slack and Teams everywhere. WhatsApp: InvGate. Microsoft 365 Copilot: Freshservice, and others through connectors. Claude and ChatGPT Enterprise: Atomicwork. Any MCP client: ServiceNow, Atlassian, Xurrent, TOPdesk, Atomicwork, Zoho (see Module: integration). [AI]
- **Unified search-and-chat entry point** — InvGate's redesigned portal has one search-and-chat bar available from every screen through a floating button (early access; mandatory portal migration in January 2027). ServiceNow and JSM show AI answers inside portal search. [AI]
- **Personalization** — InvGate shows each employee their most-used categories (last 90 days) ahead of admin-pinned ones, falling back to pinned ones when there is no history. Moveworks *Content Activities* surface relevant content at key conversation moments. [AI/rules]
- **Pre-submit deflection and known-issue attach** — Suggest answers and similar open incidents while the user types; offer "add me as affected". See Module: incident. [AI]
- **Live-agent handoff** — Moves the conversation to a human with the transcript and context: Ivanti, Moveworks *Live Agent* improvements (January 2026), JSM (raise a request from the conversation), ServiceNow (live agent in Virtual Agent). [AI]
- **Builder tooling for conversational plugins** — [AI]
  - Moveworks Agent Studio: plugins = trigger → reasoning engine selects the plugin → slots collected → actions run → response.
    - 2026 additions: Architect panel (guided plugin building, upgraded to Gemini 3.1), Data Mapper, optional and *file* slots, Python script actions, LDAP and Active Directory actions, Initiative Designer, ambient agents started from conversation, API Playground and Ticket Viewer test tools, *Permissions Checker* (verifies whether a user can access a given KB article or file), and a Data Ingestion View.
  - Freshservice AI Agent Studio; ServiceNow AI Agent Studio; Zendesk procedures.
- **Session analytics** — [AI]
  - Freshservice *Freddy AI Agent overview* report.
  - ServiceNow Conversational Catalog Overview dashboard and Now Assist Analytics.
  - InvGate with-AI vs without-AI comparisons (first-contact resolution, MTTR, adoption).
  - JSM virtual-agent reporting (assisted conversations, resolution; detail unverified).

### Implementation notes
- **Router order (copy JSM):**
  1. Deterministic intents (password reset, order status, known outages) — fast and auditable.
  2. Action-capable agent tools (catalog, ticket status, access requests).
  3. RAG answer over knowledge.
  4. Offer a request or handoff.

  Log which tier answered, for analytics and for tuning intents.
- **RAG answer contract:**
  - Retrieve with the *user's* ACL filter, plus channel scope (a Slack public channel may need a stricter policy than a DM).
  - Answer only from retrieved passages, with numbered citations to records the user can open.
  - Abstain ("I couldn't find this — want me to open a request?") when the top re-ranked score is below a calibrated threshold.
  - Never cite internal-only articles to end users. Internal procedures written for agents (Request Resolver style) are executed by the agent, not quoted.
- **Channel adapters:** one conversation core, with per-channel renderers for portal (rich cards), Slack Block Kit, Teams Adaptive Cards, email (one reply carrying all questions, as Zendesk email agents do), WhatsApp (templates and 24-hour window rules) and voice.
- **Voice:**
  - Pipeline: streaming STT → the same agent core → TTS with barge-in.
  - Latency budget under ~800 ms to first audio: use a small model for turn handling and a large model only for reasoning steps.
  - Confirm identity before account actions (callback, PIN or SSO push).
- **Handoff:** create or attach a ticket with an LLM summary of the conversation (intent, steps tried, sentiment) so the human does not ask again. Routing uses the same classifier as email triage.
- **Metering:** count sessions per unique user per 24 hours (Freshservice model) or per resolution (Zendesk model). Expose an admin budget, alerts at 80% and 100%, and a hard stop or overage policy.
- **Deflection metric:** a conversation is *deflected* only if no ticket on the same topic is opened by that user within 72 hours (embedding match), not merely because the chat ended. Report containment, deflection, CSAT, escalation reasons and top unanswered intents (knowledge-gap feed).

## Module: workforce

### Features
- **Demand forecasting and staffing** — [AI/ML]
  - ServiceNow *Workforce Optimization (WFO) Demand Forecast*:
    - Forecasts contact and case volumes at 15-, 30- or 60-minute intervals from history stored in MetricBase.
    - Uses Seasonal-Trend decomposition with Loess (STL) by default.
    - Managers adjust forecasts by hand for events and build formulas that convert volume into required staff.
    - Needs at least 3× as much history as the forecast horizon.
    - Documented for customer service; the ITSM use is less explicit.
  - Zendesk WFM (formerly Tymeshift): AI forecasting of ticket volume *and subject mix*, with a "Required staffing" calculation. 2026 early-access additions: forecast scenarios (January) and CSV import of trusted forecasts (February).
- **AI-assisted assignment and routing** — [AI]
  - InvGate *Smart ticket assignment*: uses past resolution data, current workload, availability and past outcomes; falls back to workload-based assignment when not confident; logs AI assignments in ticket history.
  - Freshservice *Precision routing* (skill-based, early access).
  - ManageEngine technician assignment prediction.
  - ServiceNow Predictive Intelligence assignment-group classification and Advanced Work Assignment (capacity- and skill-aware; ML affinity unverified).
  - TOPdesk AI Triage operator group.
  - BMC Ticket Resolver predicts urgency and impact.
- **Expert and collaborator recommendation** — InvGate Expert Collaboration, ManageEngine Collaborator Suggestion, BMC Ops Swarmer recommended participants, ServiceNow "consult on-call experts" (see Module: incident). [AI]
- **On-call schedule intelligence** — PagerDuty *Shift* agent (schedule conflicts and coverage) and *Insights* agent (operational analytics). [AI]
- **Quality assurance and coaching** — Zendesk QA scores conversations automatically (AutoQA) and picks conversations worth reviewing; category details unverified this pass. ServiceNow SIR has a quality-assessment skill. Generally, AI scoring of agent replies for empathy, accuracy, tone and policy compliance. [AI]
- **Blended human + AI workforce** — ServiceNow positions *AI Specialists* and the "Autonomous Workforce" (launched February 2026 with EmployeeWorks) as digital staff. BMC *Agent Outcomes* governs the AI workforce, and Atomicwork sells "AI Coworkers" with budgets. Capacity planning must therefore count AI-resolved volume separately from human queues. [AI]

### Implementation notes
- **Volume forecast:** per queue and channel, use STL or Holt-Winters with daily and weekly seasonality and a holiday calendar. Add regressors for planned changes and releases (known ticket generators) and the effect of major incidents (flagged as outliers and removed from training). Back-test with rolling origin; report MAPE and bias.
- **Staffing:**
  - Erlang C (or Erlang A with abandonment for chat and voice) converts interval volume and average handle time (AHT) into the agents needed for a service-level target. For email and tickets use a backlog model: required FTE = (forecast volume × AHT) / (productive hours × occupancy).
  - Subtract the expected AI containment rate, per intent, from the forecast.
- **Routing score** for each eligible agent:
  - `skill_match (embedding similarity of ticket to the agent's resolved-ticket centroid) × success_rate(category) × availability × (1 − load/limit)`.
  - Add a fairness constraint (round-robin among the top-k) to avoid starving or overloading anyone.
  - Explain the choice in the history entry, and fall back to group queue assignment below a confidence threshold (InvGate behaviour).
- **AutoQA:** an LLM judge with a rubric (greeting, empathy, correctness against the KB, policy compliance, resolution confirmation), scoring each criterion 0–2 with quotes as evidence. Calibrate against human graders monthly (Cohen's κ) and never use it for pay decisions without human review.

## Module: esm

### Features
- **HR case and chat AI** — ServiceNow Now Assist for HR Service Delivery (HRSD Pro Plus / Enterprise Plus): [AI]
  - Summarizes HR cases and chats and generates reply recommendations.
  - *Employee Relations Case Summarizer* skill (December 2025 store release).
  - *Advanced Knowledge Editor* and *voice AI agents* (March 2026 store release).
- **Employee journey agents** — ServiceNow: [AI]
  - Agentic workflows facilitate and manage employee journeys across career stages (they depend on Now Assist for HRSD `sn_hr_gen_ai` and Skills Foundation).
  - *Generate onboarding ramp-up plan* V1.3 for managers (March 2026; needs Now Assist for HRSD v13.0 and configured Employee Journeys).
  - A *schedule interviews* agent; hiring and growth-experience agentic workflows.
  - Agentic workflows for Journey Designer.
- **Cross-department agents and marketplaces** — [AI]
  - Moveworks AI Agent Marketplace (April 2025): compensation planning, expenses, PTO, timesheets, recruiting, procurement, account management.
  - Atomicwork AI Coworkers for IT, HR and finance.
  - Ivanti persona-based agents for ITSM and ESM (preview Q1 2026, GA later in 2026).
  - BMC Helix Business Workflows agents (Service Collaborator and others).
  - Freshservice for Business Teams with the Copilot add-on.
  - JSM / Service Collection for HR, facilities and legal teams (Request Resolver, virtual service agent).
  - Zendesk for employee service.
- **Department-scoped knowledge and answers** — One assistant across IT, HR and facilities that routes by intent and answers only from the content audience the employee belongs to (ServiceNow HR criteria / user criteria, JSM space permissions, Freshservice workspaces). [AI]
- **Legal, finance and facilities** — Document extraction for contracts (DocIntel / Document Intelligence), and procurement and expense agents (Moveworks marketplace; ServiceNow sourcing agents). ServiceNow Legal Service Delivery and Workplace Service Delivery Now Assist skills were not verified in this pass. [AI] (partly unverified)

### Implementation notes
- **Sensitive-department isolation:** HR, employee relations, legal and security records live in restricted *workspaces* or domains. AI retrieval for those departments uses a separate index partition with a stricter ACL check (case participants plus HR role with matching HR criteria). Embeddings from restricted cases are never placed in a shared index used by other departments' assistants.
- **One front door, many back offices:** a top-level intent router (IT / HR / facilities / finance / legal) built from catalog and KB taxonomies, then department-specific tools. Handoffs carry only the fields the receiving department may see.
- **Journeys:** journey templates (onboarding, relocation, leave) are task graphs. The LLM proposes a *personalized* plan from the template plus role, location and manager inputs, and every task maps to a real catalog item or activity, never free text that nobody fulfils.

## Module: csm

### Features
- **Case summarization, resolution notes and chat summaries** — ServiceNow Now Assist for CSM (CSM Pro Plus / Enterprise Plus): case summary (issue and actions taken), case resolution notes, and interaction chat summary. The case summarization prompt can be customized by copying the skill. [AI]
- **Reply recommendations** — ServiceNow: email recommendation from the context menu, reviewed before sending, and chat reply recommendation. Zendesk Copilot suggested replies and *auto assist*, which follows procedures. Freshdesk Freddy Copilot. [AI]
- **Triage agents for offline channels** — ServiceNow *Triage cases* AI agents handle routine cases arriving by email and other offline channels (Xanadu Patch 7). Zendesk intelligent triage covers intent, sentiment and language. [AI]
- **Voice self-service** — ServiceNow CSM AI Voice Agents (Q1 2026) with two prebuilt agents: *case status retrieval* and *case creation*. Zendesk voice AI agents. [AI]
- **Customer-facing AI agents** — Zendesk AI agents (messaging, email and voice; procedures; outcome-based resolution allowances). Atlassian Customer Service Management with the *Rovo Customer Service agent*: answers from the knowledge base and escalates to a JSM ticket, with the Slack transcript synced into ticket comments. *Rovo Agent Evals* validate and measure agents at scale. [AI]
- **CX analytics** — Zendesk QA, WFM forecasting and Explore; Freshservice and Freshdesk Freddy Insights. See Modules: analytics and workforce. [AI]

### Implementation notes
- **Account-scoped retrieval:** external users see only their account's cases and public articles. The retrieval filter adds `account_id ∈ user.accounts` and `visibility = external`. Internal work notes are excluded from every customer-facing generation and are only *summarized for agents*.
- **Entitlement-aware agents:** before creating a case or promising a response time, the agent calls `get_entitlements(account, product)` and cites the contract SLA; it never promises from free text.
- **Brand voice:** per-brand tone instructions and banned phrases, validated by a cheap classifier before sending. Zendesk "matches your tone and brand" in email agents.

## Module: analytics

### Features
- **Natural language → visualization and dashboard** — [AI]
  - ServiceNow *data visualization generation* (Now Assist / Otto panel):
    - Builds Platform Analytics visualizations from plain-language questions over any platform table, e.g. "number of open incidents" gives a single-score widget.
    - Results can be added to a dashboard. Existing dashboards and visualizations can be exported conversationally (PDF, PowerPoint) through query generation.
    - Roles: `now_assist_panel_user` plus `now_assist_analytics_generation` or `now.assist.creator.analytics`; scheduled exports also need `par_scheduler`.
  - BMC HelixGPT *Insight Finder*: builds ITSM and AIOps dashboards from natural-language requirements.
  - Atlassian Analytics (being renamed "Insights"):
    - In the chart editor (Create → Chart → Custom chart), switch to SQL mode, select Rovo and ask in natural language; Rovo returns SQL.
    - *Chart insights* summarize a chart's data in text. *Custom formulas* turn natural language into SQLite column expressions.
    - Insights adds answers grounded in organizational data without SQL. AI is on Premium / Enterprise and not available in Atlassian Government.
  - ManageEngine *Ask Zia*: technicians query data and open smart ticket views conversationally.
  - ServiceNow *schema-aware data Q&A*, which discovers schemas and samples live data read-only (see Module: platform).
- **Automatic insights (anomaly, trend, root cause)** — Freshservice *Freddy AI Insights* (Enterprise). [AI]
  - Insight types: Majority, Outliers, Trend change (spike/fall), Longest increase/decrease, Recent change, Overall trend.
  - Metrics: survey score, incoming tickets by category, resolution and first-response SLA violations, average resolution, response and first-response times, resolved tickets by status.
  - Cards are ranked by importance with criticality colours. A root-cause tree map ("Leading causes could be") has a natural-language summary.
  - Conversational access. Daily, weekly and monthly runs with minimum-history rules (see Module: slm).
  - Other examples: ServiceNow *Analyze Task Trends* (filter by assignment group, service, CI); Xurrent Sera *Brief* (detail unverified).
- **AI adoption and value analytics** — [AI]
  - InvGate (Reports → AI Hub, all tiers, refreshed every 24 hours):
    - *VSA report:* deflection, conversation volume, channel adoption, topics with no knowledge coverage.
    - *AI functionalities for agents report:* adoption (tried at least once) vs engagement (kept using), per agent and per help desk.
    - A *With AI / Without AI* filter across dashboards compares resolution time and SLA compliance.
  - ServiceNow Now Assist Analytics: Executions and Business-value dashboards, plus *AI resolution attribution* ("Closed by AI") in AIOps.
  - ManageEngine Zia token dashboard; Freshservice Freddy AI Agent overview report.
- **Process mining with AI** — ServiceNow Process Mining with Now Assist. [AI]
  - The *Process Inefficiency Highlights* skill analyzes work notes in batches of 5–50 eligible notes and highlights improvement opportunities.
  - Australia added a template for mining *agentic AI logs* and integration with Task Mining.
  - Needs Now Assist for Creator; the Process Mining plugin and Generative AI Controller install automatically.
- **Automation opportunity discovery** — [AI]
  - ServiceNow *Automation Discovery* is **deprecated**: hidden on new instances, supported through Australia.
    - Replacements: Process Mining and Task Mining, and *Now Assist for Automation Center*, which explores existing automations and creates automation requests from the Task Mining workspace.
    - A ServiceNow community recipe filters case activities that take 2–30 minutes as ideal AI or deflection targets and pushes them to Automation Center or AI Control Tower.
  - ServiceNow AIOps LEAP groups automation opportunities with GenAI.
  - BMC *Service Optimizer* finds optimization opportunities in conversation data.
- **Spike and major-incident detection** — Clustering-based major incident detection (ServiceNow, InvGate) and problem candidates (BMC Problem Solver, ManageEngine Cluster Analysis). See Modules: incident and problem. [AI]
- **Report narrative and summarization** — ServiceNow *Summarize CMDB readiness* (dashboard → findings) and Service Observability dashboard summarization; Atlassian chart insights; Freddy Insights summaries. [AI]

### Implementation notes
- **Use a semantic layer, not raw SQL from the LLM.**
  - Define metrics (MTTR, FCR, backlog, SLA attainment, reopen rate) and dimensions (group, service, category, priority, time) once.
  - The LLM maps a question to `{metric[], dimensions[], filters[], time_range, grain, chart_hint}`.
  - The server compiles that to SQL, applies the *caller's row-level security*, and renders it.
  - This prevents wrong joins, honours ACLs, and makes results reproducible. Show the interpreted query as editable chips.
- **Chart choice:**
  - Rules first: single value → score; time series → line; dimension with ≤ 7 values → bar; share → stacked bar.
  - The LLM chooses only between valid options.
- **Insight engine (classical algorithms behind each insight type):**
  - *Majority:* top contributor share ≥ 40%.
  - *Outliers:* robust z-score (median absolute deviation) or Tukey fences across members of a dimension.
  - *Trend change:* change-point detection (PELT, or binary segmentation).
  - *Longest increase or decrease:* run-length over the weekly series.
  - *Overall trend:* Mann–Kendall test with Sen's slope.
  - *Root cause:* decompose the period-over-period delta by dimension (mix-vs-rate decomposition, or Shapley contributions over the top dimensions) and render it as a tree map.
  - *Ranking:* score = effect size × business weight × novelty (not shown recently).
  - The LLM writes one or two sentences per card from these computed facts only.
- **Process mining:**
  - Build the event log from audit history: case = record, activity = state, group or assignment change, timestamp, resource.
  - Discover the directly-follows graph with frequency and performance overlays.
  - Analyze variants, conformance against the reference model, ping-pong reassignment loops, and bottleneck dwell times.
  - The LLM explains the top inefficiencies, citing variant IDs and counts.
- **Automation opportunity score** per ticket cluster:
  - `volume × median_handle_time × repeatability × automatable × (1 − existing_automation_coverage)`.
  - *Repeatability* = low variance of resolution text embeddings.
  - *Automatable* = an LLM classifies whether the resolution steps map to available actions or connectors.
  - Output a ranked backlog with estimated hours saved per month.

## Module: ai

This module covers the AI platform itself: models, guardrails, governance, evaluation, agents and their builders, metering, and the RAG stack every other module reuses.

### Features
- **AI control tower (AI governance hub)** — ServiceNow *AI Control Tower*, expanded at Knowledge 2026 (Innovation Lab May 2026; GA targeted for August 2026 with the Australia release). Its five pillars: [AI]
  - *Discover:* AI assets across the enterprise, including shadow AI, non-human identities and connected devices, through 30 new integrations (AWS, Google Cloud, Azure, SAP, Oracle, Workday).
  - *Observe:* runtime observability of agent behaviour (Traceloop acquisition).
  - *Govern:* five risk frameworks aligned to NIST and the EU AI Act, covering models, datasets and prompts as well as agents.
  - *Secure:* Veza access graph, scoped permissions, least privilege, and real-time shutdown of an agent that goes off script or beyond its permissions (marketed as a kill switch).
  - *Measure:* cost tracking and ROI dashboards.

  Related products: ServiceNow AI Risk and Compliance; BMC HelixGPT *Agent Outcomes* ("managing and governing the AI workforce"; page not readable in this pass); Atomicwork's single AI control plane with budgets, spend limits and usage guardrails per AI Coworker.
- **Guardrails** — [AI]
  - ServiceNow *Now Assist Guardian*:
    - *Prompt-injection detection* covers all generative AI apps. *Offensiveness detection* covers supported skills and is off by default, enabled per workflow. *Sensitive topic filters* cover Virtual Agent only, need HRSD, and redirect to the "Sensitivity Detection: Fallback" topic.
    - Each guardrail can log or block, with a Low / Medium / High sensitivity threshold. Zurich docs advise running log-only first. (The first research pass reported a 2026 change to always-on blocking for prompt injection in skills; check per release.)
    - Skills that use Guardian strip PII before the request reaches the LLM, and the anonymized data types are configurable.
  - Xurrent *Sera AI guardrail reviews* (August 2026).
  - TOPdesk: all AI features off by default; AI output labelled; "TOPdesk suggests, your operator decides".
  - InvGate: AI "operates within existing permissions"; responses are never sent automatically.
- **Human-in-the-loop controls** — [AI]
  - Atlassian Request Resolver supervised mode.
  - PagerDuty approval-by-default remediation.
  - ServiceNow agents show the recommendation before updating; TPRM issues and SPM risks are saved as drafts until confirmed.
  - BMC Change Coordinator and CAB Supervisor recommend but do not decide.
  - Freshservice Copilot agent actions are reportedly policy-gated per action (Always allowed / Approval required / Blocked); reported by a sibling access-control study, unverified here.
- **Agent builders (studios)** — [AI]
  - ServiceNow *AI Agent Studio* (agent role, instructions, tools such as flows, scripts, subflows and search, triggers, run-as user) and *AI Agent Orchestrator*.
  - Freshservice *AI Agent Studio*; BMC *HelixGPT Agent Builder* (no-code); ManageEngine *Zia Agent Studio* (no-code, conversational; Agent Store with 5 prebuilt agents; a master agent coordinating sub-agents).
  - Moveworks *Agent Studio* (plugins, slots, actions, Architect panel, MCP plugins); Atlassian *Rovo Studio*; Xurrent *Agent Designer* (Closure and Triage agents in July 2026, six Sera agents in September 2026).
  - Aisera Agent Library, LLM Studio, Prompt Studio and Hyperflow Studio; Halo runbook agents; Zendesk procedures.
- **Multi-agent orchestration and interoperability** — ServiceNow AI Agent Orchestrator and *AI Agent Fabric* (MCP and A2A); Zia master agent with sub-agents; Ivanti multi-agent self-service; Halo "Agent Interoperability: connect any external agent, control every permission". [AI]
- **Evaluation** — [AI]
  - ServiceNow *Agentic Evaluations*:
    - A Now LLM judge reads execution logs and scores *overall task completeness* and *tool-calling accuracy*. Tool-calling sub-metrics are combined with AND, so one zero fails the record. A third metric is named in the FAQ.
    - Runs are labelled Excellent / Good / Moderate / Poor, with customizable thresholds.
    - Datasets come from existing test cases, past execution logs, or newly generated logs (*Now Assist Data Kit*).
    - Each evaluated record consumes one *assist*.
    - *Auto-Evaluation for Now Assist Skills* tests single skills in isolation.
  - Atlassian *Rovo Agent Evals* (2026-03-12): evaluation types response accuracy, resolution rate and manual testing (bulk generation without scoring); CSV datasets; up to 3 concurrent runs.
  - Datadog *Agent Trace* view. ServiceNow stores feedback in agentic AI logs.
- **Model choice, BYO-key and BYO-LLM** — [AI]
  - ServiceNow connection tiers:
    - Out-of-box ServiceNow-managed models: Now LLM and LTS models, plus certified third-party models (Azure OpenAI, Google Gemini, Anthropic Claude on AWS).
    - *BYOK*: your own Azure OpenAI (custom resource path), Google AI Studio or AWS Bedrock.
    - *BYOLLM* through a generic LLM connector for uncertified models (separate subscription).
    - Spokes for other providers.
    - Defaults are moving to the best third-party model per use case: ITOM made Azure OpenAI the default in July 2026; SAM picks a model per use case from July 2026; 2026 apps use small and large model tiers (see Overview).
  - BMC HelixGPT 26.3 certified models:
    - Gemini 2.5 Flash on Vertex AI.
    - *Self-hosted gpt-oss-120b*, certified on Vertex AI with streaming disabled.
    - OpenAI GPT-5.4; GPT-5.1 retired in favour of 5.2 or 5.4.
    - Earlier: Llama 4 on Vertex, Oracle and Bedrock; Llama 3.1 70B on Oracle; self-hosted Llama 3 weights (25.2).
    - Fine-tuned HelixGPT-v7.4 for AIOps. Providers are provisioned with API keys in HelixGPT Manager.
  - ManageEngine: Zia LLM (Zoho-hosted, open-source foundation models), ChatGPT or Azure OpenAI, with BYOK for Google AI Studio (cloud) and Azure OpenAI (on-prem), chosen per GenAI capability.
  - Moveworks Agent Architect runs on Gemini 3.1.
  - InvGate on-prem still calls cloud-hosted models.
  - Truly *local* inference (Ollama or vLLM on customer hardware) is rare among ITSM vendors. BMC's self-hosted gpt-oss and Llama options are the closest.
- **Metering and cost controls** — [AI]
  - Atlassian Rovo credits: 100 per Request Resolver plan; allowances enforced from 2026-12-03; admin limits; alerts at 80% and 100%; optional overage.
  - Freshservice AI Agent: 1,200 sessions per license per year.
  - Zendesk: automated-resolution allowances.
  - ServiceNow: *assists* (e.g. one per evaluated record).
  - ManageEngine: Zia token dashboard.
  - Atomicwork: budgets per AI Coworker.
  - Datadog: credits shared across Bits agents (third-party report).
- **Multilingual AI** — ServiceNow AI admin console sets the languages per model provider (native vs dynamic translation). Zendesk supports 80 text languages and 53 voice languages. Freshservice and InvGate answer in the user's language. [AI]
- **AI audit and observability** — [AI]
  - ServiceNow agentic AI logs, AI resolution attribution, Traceloop-based runtime traces.
  - Xurrent *ITSM agent audit log* (August 2026).
  - Moveworks Data Ingestion View and Permissions Checker.
  - Datadog Agent Trace.
- **AI-generated-content transparency** — ServiceNow AI Lens marks AI-filled fields with a gradient. TOPdesk labels AI output. BMC records AI work in the situation or ticket, and InvGate logs AI assignments in ticket history. [AI]

### Implementation notes
- **Model router:**
  - Each skill declares a tier: `small` (classification, extraction, short rewrites), `large` (multi-step reasoning, agent planning), `embedding`, `rerank`, `stt` or `tts`.
  - Tenants map tiers to providers, e.g. small = Claude Haiku / Gemini Flash / GPT-mini or local Llama/Qwen on vLLM; large = Claude Sonnet/Opus, GPT-5.x, Gemini Pro.
  - Fallback chain on 429/5xx with jittered backoff; circuit breaker per provider.
  - *Capability guard:* never route a tool-using or vision skill to a model whose capability matrix lacks it.
  - *Eval gate:* a provider or model can only be enabled for a skill after the skill's golden set passes on that model (see evaluation below).
- **Local models (Ollama, vLLM, LM Studio):**
  - Treat them as OpenAI-compatible endpoints.
  - Probe `/v1/models` and run a capability self-test: JSON mode, tool calling, context length.
  - Where native tool calling is missing, use constrained JSON (a grammar or JSON schema) ReAct.
  - Offer a "no data leaves the network" tenant mode that pins every tier, embeddings included, to local endpoints and disables web-search tools.
- **Prompt-injection defense (OWASP LLM01) in depth:**
  1. Mark all untrusted text (email bodies, ticket comments, KB articles, web pages, tool results) as *data*: wrap it in tagged delimiters and tell the model in the system prompt never to follow instructions inside them.
  2. Run an input classifier (small model or fine-tuned detector) on untrusted segments, with a log or block policy per skill (Guardian model).
  3. *Capability scoping:* the agent gets only the tools its skill needs, each with argument validation and per-tool risk class (`read`, `write-low`, `write-high`, `external-send`).
  4. *Taint rule:* a `write-high` or `external-send` call whose arguments derive from untrusted content requires human confirmation.
  5. *Output filters:* block secrets and PII patterns and links to non-allowlisted domains in outbound messages.
  6. Red-team suites (indirect injection in emails and KB) run in CI.
- **PII handling:**
  - Detect with regex (email, phone, IBAN, national IDs, IPs) plus an NER model, configurable per tenant.
  - Replace with *reversible placeholders* (`<PERSON_1>`) before the LLM call, and re-hydrate in the response only for users allowed to see the originals.
  - Never put raw PII into embeddings for shared indexes. Log the redaction map hash, not the values.
- **Agent runtime contract:**
  - `agent_run(id, agent_id, trigger, run_as_user|ai_user, goal, status, steps[], tool_calls[{tool, args, result_ref, risk, approved_by}], cost, outcome, closed_by_ai)`.
  - Every step is persisted, so runs resume after a restart.
  - Budgets are enforced per run (tokens, tool calls, wall-clock) and per tenant per month.
  - A *kill switch* per agent and globally sets the status to `suspended` and revokes the agent's tokens.
- **RAG architecture (shared by portal, agents, summaries and search):**
  - *Ingestion:*
    - Connectors (KB, catalog, resolved tickets, SharePoint, Confluence, Google Drive, web) capture the *ACL principals* of every source item (users, groups, roles, audiences) and incremental changes through webhooks or delta APIs, with periodic full re-sync.
    - Store a `freshness_window`: the maximum lag allowed between a source permission change and the index (Atlassian Rovo exposes this concept; InvGate syncs SharePoint every 3 hours).
  - *Chunking:*
    - Structure-aware: split on headings, keep lists and tables whole, 300–800 tokens with 10–15% overlap; prefix title and breadcrumb.
    - Use *small-to-big*: index ~150–250-token child chunks and return the parent section to the LLM. This is ServiceNow AI Search RAG's 2026 default.
    - Tickets: index an AI-written *resolution digest* (symptom, cause, fix) instead of raw threads.
  - *Embeddings:* a multilingual model, so mixed-language tenants work (the Persian + English case included). Store vectors in an ANN index (HNSW, e.g. pgvector) with metadata: `kb, audience_ids[], language, product, valid_to, updated_at, source_type`.
  - *Hybrid retrieval:*
    - BM25 (Postgres FTS or OpenSearch) and vector kNN run in parallel, *both pre-filtered* by the caller's principal set and metadata filters, then merged with reciprocal rank fusion (k ≈ 60).
    - Query rewriting: spelling, acronym expansion from a tenant glossary, and multi-query for vague questions.
  - *Re-ranking:* a cross-encoder (bge-reranker or a hosted rerank API) or a small LLM re-ranks the top 50 to the top 6–8.
  - *Freshness:* exclude expired or retired items (`valid_to`, retired CI or product). Apply a recency decay for operational content (outages, known errors); none for policy documents.
  - *Generation:*
    - The answer may use only the provided passages, cites `[n]`, and abstains below a calibrated retrieval-score threshold.
    - Post-check citations: each cited passage must actually support the sentence (NLI or LLM verifier). Drop unsupported sentences or regenerate.
  - *Permission re-check at render time:* before showing a citation, re-evaluate the *live* ACL of the source record for the viewer. Never serve cached answers across different ACL fingerprints.
- **Evaluation program:**
  - *Offline golden sets* per skill and agent: inputs, expected outputs or properties, expected sources.
    - Retrieval: recall@k, MRR, nDCG.
    - Generation: groundedness or faithfulness, answer relevance, citation precision (LLM judge, calibrated against human labels with Cohen's κ).
    - Classification: precision, recall and calibration per class.
    - Agents: task completeness, tool-call accuracy and argument validity, steps to success, policy violations (ServiceNow metric model).
  - *Permission-leak tests:* synthetic users with narrow ACLs ask questions whose answers live only in restricted records. The pass criterion is zero restricted documents retrieved or cited.
  - *Regression gates:* any prompt, model or retrieval change runs the suite; block the release on degradation beyond tolerance.
  - *Online:* accept and edit rates, edit distance, thumbs, deflection (no ticket within 72 hours), reopen rate, CSAT, cost per resolved item.
  - *Shadow mode and canaries* for new agents, then supervised mode, then autonomous (Request Resolver progression).
