# Other ITSM/IT governance frameworks and standards — what a tool must support

*Research date: 2026-11-07. Scope: the non-ITIL service-management, IT-governance, risk, security, asset, reliability, knowledge, experience, privacy, accessibility and AI-governance frameworks that an enterprise ITSM platform is expected to support, translated into concrete records, workflows, controls, reports and evidence and mapped to the product's canonical module keys. Facts not confirmed against a source in this session are marked "(unverified)". The shared web-search quota ran out part-way through the session; after that, facts were checked by fetching official pages directly where possible, otherwise taken from the standards' text as known and flagged where uncertain.*

## Overview

### Positioning

Frameworks and standards do not ship software. They put five kinds of demand on a tool:

1. **Records**: the objects the framework names, such as a CI with "unique identification, type, description, relationships, status" (ISO/IEC 20000-1 §8.2.6), a KCS article with Issue/Environment/Resolution/Cause, a BIA with RTO/RPO/MTPD, or an ISO 19770-3 entitlement.
2. **Mandatory activities**, often required "at planned intervals" (ISO/IEC 20000-1 uses the phrase dozens of times: SLA reviews, CMDB verification, supplier reviews, continuity tests, risk assessments, change-trend analysis).
3. **Controls**: segregation of duties, authorisation, access restriction, retention, logging.
4. **Evidence**: immutable history, documented information, reports, audit packs and regulator submissions.
5. **Metrics with exact formulas**: KCS link rate and Contribution Index, DORA metrics, SRE burn rate, HappySignals Happiness score, HDI and FitSM service reporting.

A tool "supports" a framework when an auditor, assessor or regulator can verify conformance from the tool's own data. The frameworks fall into three families, and each family suggests one engine to build once:

- **Management-system standards** (ISO/IEC 20000-1, 27001, 22301, 55001, 19770-1, 42001, 27701, 30401, 41001, 44001, 9001) share the ISO harmonized structure (clause 4 Context → 5 Leadership → 6 Planning → 7 Support → 8 Operation → 9 Performance evaluation → 10 Improvement). Since the 2024 "climate action" amendments, they also require the organisation to decide whether climate change is a relevant issue. Build one **management-system kernel**.
- **Process and practice frameworks** (COBIT, FitSM, VeriSM, SIAM, IT4IT, MOF, USM, KCS, Google SRE, DORA metrics, Lean/Kanban, XLA, CMMI, HDI, eTOM) define process records, roles, review cadences and metrics. Build **configurable process packs** on one workflow engine.
- **Regulations and control catalogues** (GDPR, EU AI Act, EU DORA, NIS2, NIST CSF 2.0, NIST SP 800-61r3, SOC 2, PCI DSS, WCAG 2.2/EAA) define deadlines, notifications, controls and data-subject rights. Build a **requirement and control library with crosswalks**, plus a **regulatory clock engine**.

**Naming collision:** "DORA metrics" (DevOps Research and Assessment) and "EU DORA" (the Digital Operational Resilience Act, Regulation (EU) 2022/2554) are different things. This report always writes "DORA metrics" or "EU DORA".

### Versions and status (as of November 2026)

| Framework / standard | Steward | Current version and status | How conformance is assessed | Main modules |
|---|---|---|---|---|
| ISO/IEC 20000-1 (SMS requirements) | ISO/IEC JTC 1/SC 40 | **20000-1:2018 + Amd 1:2024 (climate action)**; no newer edition or DIS found. Family: 20000-2:2019 (+Amd 1:2020) guidance; 20000-3:2019 scope/applicability; TS 20000-5:2022 implementation guidance; 20000-6:2017 audit bodies; TR 20000-7:2019 integration with 9001/27001 (listed as withdrawn on Wikipedia, unverified); 20000-10:2018 concepts & vocabulary (confirmed 2025); TS 20000-11:2021 relationship with ITIL; TR 20000-12 relationship with CMMI-SVC and 20000-13 relationship with COBIT (years unverified); **TS 20000-14:2023 guidance on SIAM in an SMS** (published 26 Nov 2023); **TS 20000-15:2024 Agile and DevOps principles**; **TR 20000-17:2024 practical application scenarios**; **TS 20000-16:2025 sustainability guidance**; **TS 20000-18:2026 experience management (XM/XLA) in an SMS**, published 6 Oct 2026; **AWI TS 20000-19 guidance on the use of AI in an SMS** (working draft since 18 May 2026). Parts 4 and 9 withdrawn (part 4 replaced by ISO/IEC 33054 PRM / 33074 PAM) | Third-party certification of the SMS | almost all |
| COBIT | ISACA | **COBIT 2019** (40 governance/management objectives) remains the published reference body. **COBIT 7** was reported as launched on 27 Oct 2026 (one training partner says 19 Nov 2026), with two new design factors (Organizational Health Context; Information/Data Strategies), AI risk scenarios and AI delivery enablers, a subscription digital platform, "new activities at every capability level" and a three-tier assessment module (board, high-level, detailed). isaca.org's COBIT page still listed only COBIT 2019 products when fetched, so objective-level changes are unverified. COBIT 2019 Foundation exam retires 26 Apr 2027 | Process capability (0–5) and focus-area maturity assessments; individual certificates | security, analytics, access, change, cmdb, itam, slm, continuity, project, financial |
| FitSM | ITEMO e.V. (EU-funded origin, CC BY 4.0) | **FitSM 3.0**: FitSM-0 v3.0.1 overview & vocabulary; **FitSM-1 v3.0.1 (21 May 2024): 17 general requirements in 7 categories (GR1 MCA, GR2 DOC, GR3 SCS, GR4 PLAN, GR5 DO, GR6 CHECK, GR7 ACT) and 65 process requirements in 14 processes (PR1–PR14)**; FitSM-2 v3.0.2 "Process activities and implementation" (objective, key questions, setup and ongoing activities, inputs/outputs, interfaces per process); FitSM-3 v3.0.1 role model (22 May 2024); FitSM-4 templates & samples; FitSM-5 implementation guides; FitSM-6 maturity and capability assessment (XLS). FitSM 2.x (2016) numbering differs from 3.0 | Self-assessment; organisational certification; individual certificates | lightweight baseline for all core modules |
| VeriSM | IFDC | VeriSM model: organisational governance, SM principles, management mesh (resources, environment, emerging technologies, management practices), Define/Produce/Provide/Respond | Individual certificates | service_portfolio, esm, platform |
| SIAM Body of Knowledge | Scopism/EXIN community | **SIAM BoK v3.0**, launched Nov 2025 (Service North, 4 Nov 2025): one conceptual BoK with a stable Core (Foundation + Professional) and frequently updated Compendiums (SIAM processes, SIAM & AI, SIAM & ISO standards, procurement, end-to-end measurement, trust, collaborative culture) | Individual certificates | supplier, integration, access, slm, incident, change, problem, analytics |
| IT4IT | The Open Group | **IT4IT Standard 3.0 / 3.0.1**: seven value streams (Evaluate, Explore, Integrate, Deploy, Release, Consume, Operate), successors of v2.x S2P/R2D/R2F/D2C; digital-product backbone | Individual certificates; architecture conformance | service_portfolio, request, release, devops, event, financial, integration |
| MOF | Microsoft | MOF 4.0 (2008), legacy and not maintained | — | historical reference for change, event, analytics, access |
| USM | SURVUZ Foundation (NL) | USM method: "no more than five processes and eight workflows"; Enterprise Service Management Architecture; Service Model Canvas | Individual certificates; tool alignment | esm, request, change, incident |
| KCS | Consortium for Service Innovation | **KCS v6 Practices Guide**, continuously updated: the Article Quality Index (AQI) is now the **Content Standard Checklist**; **PAR 2.0** released July 2025 | "KCS v6 Verified" tool programme; individual certificates | knowledge, incident, portal, csm, workforce, analytics |
| Google SRE | Google | *Site Reliability Engineering* (2016) and *The SRE Workbook* (2018), both online at sre.google | — | event, slm, problem, workforce, devops, continuity |
| DORA metrics | DORA (Google Cloud) | **2025 "State of AI-assisted Software Development"**; five delivery metrics: throughput = change lead time, deployment frequency, failed deployment recovery time; instability = change fail rate, deployment rework rate. Fixed low/medium/high/elite tiers replaced by team archetypes; companion **DORA AI Capabilities Model** (seven capabilities) | DORA Quick Check self-assessment | devops, change, release, analytics |
| Lean / Agile / Kanban | Kanban University; Kanban Guide; Flow Framework | Kanban practices and cadences; flow metrics | — | request, project, workforce, analytics |
| XLA / experience management | HappySignals and XLA practitioners | Happiness score −100…+100 (%9–10 minus %0–6 on a 0–10 scale) and perceived lost time; XLA targets per team or service | — | slm, analytics, portal |
| ISO/IEC 19770 (ITAM) | ISO/IEC JTC 1/SC 7 | -1:2017 + Amd 1:2024 (ITAM system requirements); -2:2015 SWID tags; -3:2016 entitlement schema; -4:2017 resource utilisation measurement; -5:2015 vocabulary (third edition in approval); -8:2020 mapping of industry practices; -11:2021 audit/certification bodies; **TS 19770-10:2025** implementation guidance (16 Jun 2025); TS 19770-13 sustainability (published 2025/2026, sources conflict) | ITAM system certification | itam, cmdb, financial |
| ISO 55000 family | ISO/TC 251 | **ISO 55000:2024, 55001:2024** (July 2024; new decision-making, data & information and knowledge requirements); ISO 55012 (people) and 55013 (data), 2024 | Certifiable | itam, field_service, financial |
| ISO/IEC 27001 / 27002 | ISO/IEC JTC 1/SC 27 | 27001:2022 + Amd 1:2024; 27002:2022 (93 controls); 27035-1/-2:2023 incident management; **27701:2025** standalone privacy management system (published 14 Oct 2025) | Certifiable | security, access, incident, change, cmdb, supplier, continuity, event |
| ISO 22301 | ISO/TC 292 | 22301:2019 + Amd 1:2024; ISO 22313 guidance; ISO/TS 22317 BIA | Certifiable | continuity |
| NIST CSF | NIST | **CSF 2.0** (26 Feb 2024): Govern, Identify, Protect, Detect, Respond, Recover; 22 categories, 106 subcategories; organizational and community profiles; tiers | Self-assessed profiles | security, cmdb, supplier, incident, analytics |
| NIST SP 800-61 | NIST | **Rev. 3 (April 2025)**, *Incident Response Recommendations and Considerations for Cybersecurity Risk Management: A CSF 2.0 Community Profile*; supersedes Rev. 2 (2012) | — | incident, security |
| ISO 31000 | ISO/TC 262 | 31000:2018 current; revision at committee-draft stage (ISO/CD 31000, stage 30.60, Mar 2026) | Not certifiable | security, continuity, change, supplier |
| CMMI | ISACA / CMMI Institute | **CMMI V3.0** (2023): 31 practice areas (17 core + 14 domain-specific); service areas include Service Delivery Management, Strategic Service Management, Incident Resolution & Prevention and Continuity; new optional areas: Data Management, Data Quality, Enabling Safety, Enabling Security, Enabling Virtual Work, Managing Security Threats & Vulnerabilities, Workforce Empowerment | Benchmark appraisals (maturity/capability levels) | analytics, platform, all process modules |
| HDI Support Center Standard | HDI | Eight scored categories: Leadership; Policy & Strategy; People Management; Resources; Processes & Procedures; People Satisfaction; Customer Satisfaction; Performance Results. Standards updated 2024; certification valid two years | On-site or virtual audit | incident, workforce, analytics, portal, knowledge |
| eTOM | TM Forum | Business Process Framework, with Open Digital Architecture and Open APIs | API conformance certification | csm, event, field_service, integration |
| GDPR | EU | Regulation (EU) 2016/679; EDPB Guidelines 01/2022 on the right of access | Supervisory authorities | platform, admin, access, portal, ai, security |
| WCAG / EAA | W3C / EU | **WCAG 2.2** (W3C Recommendation, 5 Oct 2023): 9 new success criteria, 4.1.1 Parsing removed. European Accessibility Act (Directive 2019/882) applies since 28 Jun 2025. ISO/IEC 40500 adoption of 2.2 and the WCAG 2.2-based EN 301 549 update are unverified | Accessibility Conformance Report (VPAT) | portal, platform, csm |
| ISO/IEC 42001 | ISO/IEC JTC 1/SC 42 | 42001:2023 (AI management system; 38 Annex A controls in 9 objectives); companions ISO/IEC 23894:2023 (AI risk) and 42005 (AI impact assessment, 2025, unverified) | Certifiable | ai, admin, analytics |
| EU AI Act | EU | Regulation (EU) 2024/1689, amended by the **Digital Omnibus on AI, Regulation (EU) 2026/1744** (in force 27 Jul 2026). Prohibitions and AI-literacy duty since 2 Feb 2025; Art. 50 transparency from 2 Aug 2026, with an Art. 50(2) marking grace period to 2 Dec 2026 for generative systems already on the market; Annex III high-risk deferred to **2 Dec 2027**; Annex I to **2 Aug 2028** | Market surveillance authorities | ai, portal, workforce, csm |
| EU DORA *(scope addition)* | EU | Regulation (EU) 2022/2554, applies since 17 Jan 2025; RTS on incident classification (Del. Reg. 2024/1772) and on report content and time limits (Del. Reg. 2025/301); ITS register of information | ESAs / national competent authorities | incident, supplier, continuity, cmdb, change, security |
| NIS2 *(scope addition)* | EU | Directive (EU) 2022/2555; Art. 23 reporting 24 h / 72 h / 1 month; Implementing Reg. (EU) 2024/2690 for digital-infrastructure entities | National competent authorities / CSIRTs | incident, security, supplier |
| Other relevant standards *(scope addition)* | various | SOC 2 Trust Services Criteria; PCI DSS v4.0.1; TBM Taxonomy 4.1; FinOps FOCUS v1.4; ISO 30401 (knowledge management); ISO 44001 (collaborative relationships); ISO 41001 (facility management); ISO 10002/10004/18295 (complaints, satisfaction, contact centres); NIST AI RMF 1.0 + NIST AI 600-1 (GenAI profile); SFIA; ISO/IEC 38500 (governance of IT; 2024 edition details unverified); interchange standards: SWID/CoSWID (RFC 9393), SPDX 3.0 / ISO/IEC 5962, CycloneDX (ECMA-424), CVSS 4.0, EPSS, CISA KEV, SSVC, CSAF 2.0/VEX, SCIM 2.0, SAML/OIDC, DMTF CMDBf, OpenSLO, OpenTelemetry, CloudEvents, TMF Open APIs | — | integration, itam, security, financial, csm |

### What certification or assessment needs from the tool

- **ISO MSS certification** (20000-1, 27001, 22301, 55001, 19770-1, 42001, 27701) needs the mandatory documented information, operational records, internal audit programme and results, management review inputs and outputs, and nonconformity/corrective-action records. Standard-specific artefacts: Statement of Applicability (27001, 42001), service management plan (20000-1 §6.3), BIA (22301), strategic asset management plan (55001), AI system impact assessments (42001).
- **COBIT** capability assessment needs per-practice evidence of activities at each capability level, and process work products (inputs/outputs named per management practice).
- **CMMI** appraisal needs objective evidence per practice, sampled across projects or services.
- **HDI** certification needs scores per category, with satisfaction (customer and staff) measurement and performance-results evidence.
- **KCS Verified** requires tool behaviour: article-state metadata, linking, reuse counting, flag/fix and audience rules.
- **SOC 2 Type 2** needs complete populations for the audit period (e.g., every production change with approval and test evidence) so auditors can sample.
- **Regulators** (EU DORA, NIS2, GDPR, SEC) need timestamped submissions in prescribed templates within statutory clocks.

### Architecture takeaways for the builder

1. **Management-system kernel**: context issues, interested parties, scope, policies, objectives, risks & opportunities, roles, competence, awareness/communication, documented information, internal audit, management review, nonconformity/CAPA and improvement register. Shared by every ISO MSS; tagged by standard.
2. **Requirement library and evidence graph**: clauses, controls and subcategories as data; many-to-many crosswalks; every operational record can be linked as evidence for one or more requirements over a period.
3. **"Planned interval" engine**: recurring reviews generated as tasks with owners, due dates and evidence capture, with overdue escalation. One engine serves SLA reviews, CMDB audits, supplier reviews, access recertification, BC tests, risk reviews, KB article reviews and policy reviews.
4. **Regulatory clock engine**: multi-regime deadlines (EU DORA, NIS2, GDPR, SEC, sector rules) computed from explicit "aware" and "classified" timestamps, with report templates and submission logs.
5. **Metric library with canonical formulas**: KCS, DORA metrics, SRE, XLA, HDI, FitSM/20000 service reporting and CSF profiles. Formulas are versioned so historical reports remain reproducible.
6. **AI governance layer** (ISO/IEC 42001 + EU AI Act): AI system register, impact assessments, transparency labelling, human-oversight gates, event logs, AI incident handling. It enforces the user's permissions on every retrieval and every action.
7. **Privacy layer** (GDPR, ISO/IEC 27701:2025): retention schedules, legal hold, DSAR, erasure/anonymisation, ROPA, DPIA and breach workflow.
8. **Accessibility** (WCAG 2.2 AA) as a non-functional requirement for every UI: the agent workspace, portal, Kanban boards and AI chat.

## Sources

Fetched and read in this session:
- https://www.fitsm.eu/fitsm-parts/
- https://www.audit-academy.be/fr/actualites/launch-of-cobit-7-by-isaca
- https://egit.co.za/cobit-7/
- https://www.isaca.org/resources/cobit
- https://www.isaca.org/resources/news-and-trends/newsletters/atisaca/2026/volume-12/thirty-things-cobit-taught-us-about-governing-technology
- https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide
- https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide/030/040/010/020 (Technique 5.1 Article Structure)
- https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide/030/040/010/030 (Technique 5.2 Article State)
- https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide/030/040/020/060 (Technique 6.5 Process Adherence Review)
- https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide/030/040/030/020 (Technique 7.1 Roles and Licensing Model)
- https://sre.google/workbook/alerting-on-slos/
- https://dora.dev/guides/dora-metrics/
- https://dora.dev/research/2025/dora-report/
- https://dora.dev/ai/capabilities-model/
- https://support.happysignals.com/how-are-happiness-and-lost-time-values-calculated
- https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/
- https://riskprofs.com/iso-42001-annex-a-controls-list/
- https://processgroup.com/changes-in-cmmi-v3
- https://www.vertexinc.com/company/news/vertex-receives-virtual-hdi-support-center-certification
- https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- https://www.scopism.com/blog/the-2025-siam-bok-update-getting-started/
- https://focus.finops.org/focus-specification/
- https://www.tbmcouncil.org/learn-tbm/tbm-taxonomy/
- https://usm-portal.com/

Consulted through search results and snippets:
- https://standards.iteh.ai/catalog/standards/iso/6f036160-a64f-4b31-961a-e3187756d873/iso-iec-20000-1-2018-amd-1-2024
- https://standards.iteh.ai/catalog/standards/iso/f38301a5-abc2-4a1c-a7ab-4f8b69b8d495/iso-iec-ts-20000-16-2025
- https://apmg-international.com/zh-hans/article/isoiec-20000-revised-parts-1-and-10-have-been-published
- https://www.innovativelearning.eu/news-resources/news/cobit-7-launch-cobit-2019-retirement-and-key-exam-dates.html
- https://www.isaca.org/resources/white-papers/2025/leveraging-cobit-for-effective-ai-system-governance
- https://pubs.opengroup.org/it4it/3.0/snapshot/Digital_Management.html (login-gated; snippet only)
- https://digital-portfolio.opengroup.org/it4it-standard/latest/NormativeText/L1G_Request-to-Fulfill.html (snippet only)
- https://www.opengroup.org/sites/default/files/pdf/IT4IT_Service_Model_Guide_v2_3.pdf (snippet only)
- https://www.scopism.com/its-live-the-updated-siam-body-of-knowledge-is-ready-for-download/
- https://blogs.bmc.com/verism-management-mesh
- https://www.servicenow.com/docs/bundle/zurich-servicenow-platform/page/product/knowledge-management/concept/managing-kcs-article-states.html
- https://www.serviceinnovation.org/aqi-is-content-standard-checklist/
- https://csrc.nist.gov/pubs/sp/800/61/r3/final
- https://www.nist.gov/news-events/news/2025/04/nist-revises-sp-800-61-incident-response-recommendations-and-considerations
- https://cd.foundation/blog/2025/10/16/dora-5-metrics/
- https://redmonk.com/rstephens/2025/12/18/dora2025/
- https://www.happysignals.com/product/xla-management
- https://www.happysignals.com/blog/adding-xlas-to-contractual-agreements-the-four-main-options-in-detail
- https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
- https://www.fma.gv.at/en/dora-ict-related-incidents/
- https://advisera.com/cdr-2025-301/time-limits-for-the-initial-notification-and-for-the-intermediate-and-final-reports/
- https://www.springlex.eu/en/packages/nis2/nis2-directive/article-23/
- https://committee.iso.org/sites/tc251/home/projects/published/iso-55001.html
- https://nqa.com/getmedia/ae470aa9-94ac-4536-b318-eb1c37ae81a5/NQA-ISO-55001-Gap-Guide-2024.pdf
- https://isme.me/en/project/show/iso:proj:88574 (ISO/CD 31000 status)
- https://www.dnv.com/news/2025/iso-iec-27701-standard-update-release/
- https://standards.iteh.ai/catalog/standards/iso/0dd36594-2075-4606-be4c-c71e52488382/iso-iec-ts-19770-10-2025
- https://genorma.com/en/standards/iso-iec-cd-19770-5
- https://www.thecoresolution.com/cmmi-v3-update-explained
- https://www.thinkhdi.com/Certification
- https://blog.ansi.org/ansi/iso-9001-2026-qms-revision-updates/

## Module: platform

### Features
- **Harmonized management-system kernel** — One object set for clauses 4–10, reused by every ISO management-system standard the product supports:
  - Context issues register: internal/external issue, effect, review date, and a "climate change relevant? yes/no + rationale" field required by the 2024 climate-action amendments.
  - Interested-parties register: party, needs and expectations, and which of them become MS requirements.
  - Scope statement: services, locations, organisational units, exclusions and justification.
  - Policies, versioned and approved.
  - Objectives: measurable target, owner, resources, due date, evaluation method.
  - Risks & opportunities, roles & authorities, competence and awareness records, communication plan (what, when, with whom, who communicates).
  - Internal audit programme, management reviews, nonconformities & corrective actions, continual-improvement register.

  [ISO/IEC 20000-1:2018 §4–10; ISO/IEC 27001:2022 §4–10; ISO 22301:2019; ISO 55001:2024; ISO/IEC 42001:2023; ISO/IEC 19770-1:2017; ISO/IEC 27701:2025; Amd 1:2024 climate action]
- **Requirement & control library with crosswalks** — Clause and control catalogues stored as data, linked many-to-many: 20000-1 clauses, 27001 Annex A (93 controls), NIST CSF 2.0 (106 subcategories), COBIT 2019 objectives/practices, 42001 Annex A (38 controls), FitSM GR/PR requirements, EU DORA articles, NIS2 Art. 21 measures, SOC 2 TSC, PCI DSS 4.0.1. Each requirement links to policies, procedures, controls, owners, operational records and evidence, with a per-requirement status (not started / partially / implemented / effective) and gap notes. [all frameworks]
- **Documented-information control** — A document register with:
  - Metadata: ID, title, type (policy, plan, procedure, work instruction, template, record, external document), owner, version, classification.
  - Lifecycle: Draft → In review → Approved → Published → Under revision → Superseded/Retired.
  - Approvers and approval dates, review frequency and next-review date, distribution/access list, retention period and disposition rule, change log, "external origin" flag.

  It ships a mandatory-document checklist per standard. For 20000-1 §7.5.4 this is: SM policy & objectives, service management plan, change management policy, information security policy, service continuity plan(s), SMS processes, service requirements, service catalogue(s), SLAs, contracts with external suppliers, agreements with internal suppliers or customers acting as suppliers, the procedures the standard requires, and the records needed to show conformity. [ISO/IEC 20000-1 §7.5; ISO/IEC 27001 §7.5; FitSM GR2 Documentation]
- **"At planned intervals" scheduler** — Recurring review rules: object type + scope filter + RRULE frequency + task template + owner resolution + grace period. The scheduler generates review tasks such as:
  - SLA/OLA/contract reviews and CMDB verification
  - service availability and continuity risk assessments and continuity tests
  - supplier performance reviews and customer satisfaction surveys
  - change-record trend analysis and capacity reviews
  - access recertification, risk reviews, policy reviews and KB article reviews

  Completion captures evidence. Overdue reviews escalate and can raise a nonconformity candidate. [ISO/IEC 20000-1 passim; ISO/IEC 27001 §9; COBIT MEA01; KCS T5.10]
- **Immutable audit trail** — Field-level history on every record: who, when, old/new value, channel (UI, API, integration, AI agent), reason. History is append-only and hash-chained, with periodic anchor export to WORM storage. Configuration changes to the tool are audited too. AI-initiated changes carry the AI system ID, model/version and the human approver. [ISO/IEC 20000-1 §8.2.6 "changes to CIs traceable and auditable"; ISO/IEC 27001 A.8.15 logging, A.8.17 clock synchronization; COBIT DSS06.05 traceability; GDPR Art. 5(2) accountability; EU AI Act Art. 12/19/26(6) logs; ISO/IEC 42001 A.6.2.8 event logs; SOC 2 CC7/CC8]
- **Process-agnostic workflow/lifecycle engine** — Per-record-type state models, guarded transitions (required fields, approvals, checklists, SoD rules), parallel tasks, timers, escalations and sub-flows. Swappable "process model packs" ship as configuration: ITIL-style, FitSM 14-process, USM 5-process/8-workflow, MOF SMFs and IT4IT value-stream views. [FitSM-1; USM; MOF 4.0; IT4IT]
- **Approval engine with segregation of duties** — Single, serial, parallel, quorum and risk-tiered approvals; delegation with validity periods and audit; recusal. SoD predicates are evaluated at transition time (requester ≠ approver; implementer ≠ approver; approver ≠ CI owner when required), and overrides are logged as exceptions needing second-level approval. [ISO/IEC 27001 A.5.3 segregation of duties; COBIT DSS06.03; SOC 2 CC8.1; PCI DSS 4.0.1 6.5.1]
- **Versioned classification schemes** — Category trees, impact/urgency/priority matrices, change categories, cause/closure codes, CI classes, information classification labels and audience values, all with effective-dated versions so historical reports stay correct. A common data dictionary can be shared with every provider in a SIAM ecosystem. [COBIT DSS02.01 "define classification schemes"; ISO/IEC 20000-1 §8.6.1; ISO/IEC 27001 A.5.12/A.5.13; SIAM BoK]
- **Business calendars, time zones and clocks** — Holiday and business-hour calendars per region, service, provider and SLA; all timestamps stored in UTC from NTP-synchronised sources; separate calendar-time clocks for regulatory deadlines. [ISO/IEC 27001 A.8.17; EU DORA/NIS2/GDPR clocks]
- **Records retention, archiving & legal hold** — Retention schedules per record class with a trigger (closed date, contract end), retention period, disposition (delete, anonymise, archive) and legal-hold override. Disposition runs are logged as evidence. Articles or records still referenced by incidents are archived, not deleted. [GDPR Art. 5(1)(e), 17; ISO/IEC 27001 A.5.33 protection of records; KCS T5.2]
- **Field-level security & data masking** — Per-field read/write rules, masking of sensitive fields (national ID, salary, health data) with reveal-with-reason logging, and attachment-level ACLs. [ISO/IEC 27001 A.8.3, A.8.11; GDPR Art. 25, 32]
- **PII detection & redaction** — Detects personal data in ticket text, attachments, chat transcripts and AI prompts. It proposes redaction or minimisation and tags records containing special-category data. [AI] [GDPR Art. 5(1)(c), 9; ISO/IEC 27701:2025]
- **Internationalisation & accessibility** — Multi-language UI and content (translation workflow for KB and catalogue), full RTL support, locale formats and multiple calendars. Every UI is built to WCAG 2.2 AA:
  - focus not obscured by sticky headers (2.4.11)
  - 24×24 CSS-px targets (2.5.8)
  - non-drag alternatives (2.5.7)
  - consistent help placement (3.2.6)
  - no redundant entry (3.3.7)
  - accessible authentication (3.3.8)
  - status messages announced (4.1.3)

  [WCAG 2.2; EAA; EN 301 549]
- **Evidence/audit pack export** — For a chosen requirement set and period, exports the policy versions in force, process records (full populations plus samples), review completions, approvals, test results and hash proofs, as PDF/CSV/JSON. [ISO certification audits; SOC 2 Type 2; CMMI appraisal; COBIT assessment]
- **Notifications & communications** — Template-based, multi-channel (email, SMS, push, chat, voice/paging), audience-aware (internal/partner/customer/public), approval of external statements, and a delivery log as evidence. [ISO/IEC 20000-1 §7.4 communication; EU DORA Art. 14; NIST CSF RS.CO/RC.CO]
- **Search** — Global and faceted search, natural-language search, and an "include archived" mode for advanced users. [KCS T5.2, T6.3]
- **Mobile** — Approvals, on-call acknowledgement, incident updates, asset scanning (barcode/RFID) and offline field work, with the same access rules and audit. [SRE on-call; ISO 55001 field data capture]
- **Sustainability attributes** — Energy, carbon, e-waste and refurbishment fields on services and assets, plus sustainability objectives within the MS kernel. [ISO/IEC TS 20000-16:2025; ISO/IEC TS 19770-13; climate-action amendments 2024]

### Implementation notes
- **Kernel schema.** `ms_standard`, `ms_requirement(standard_id, clause_ref, text, parent_id)`, `ms_mapping(req_a, req_b, strength)`, `control(id, owner, type, frequency)`, `control_requirement`, `evidence(id, requirement_id|control_id, record_type, record_id, period_start, period_end, captured_at, hash, captured_by)`. Each MS object (policy, objective, risk, audit, finding, management review) carries `standards[]` tags, so one internal audit can cover 20000-1 and 27001 together (integrated management system; TR 20000-7 explains this integration).
- **Planned-interval engine.** Store rules as RRULE strings. Generate tasks idempotently, keyed by `(rule_id, period)`. Completion requires the configured evidence (attachment, checklist, sign-off). Expose "% reviews done on time" per standard as a conformity KPI.
- **Hash-chained history.** `history(table, row_id, seq, actor, actor_type, at_utc, diff_json, prev_hash, hash = SHA-256(prev_hash || canonical(diff_json)))`. Compute a daily Merkle root per table and export it, which makes tampering detectable. Avoid UPDATE/DELETE privileges on history for application roles.
- **Snapshot-at-use.** Store the matrix version, SLA-definition version, KB-article version and policy version on each record when they are applied. Audits ask "what rule applied then?"
- **SoD.** Express rules as predicates over `(actor, record, role, relationship)`, evaluate them in the transition guard, and keep a violation log. Approval delegation is itself an auditable record (delegator, delegate, scope, validity).
- **Accessibility.** Build drag-and-drop (Kanban, CAB calendar, dashboards) with keyboard and menu alternatives from day one. Run automated axe checks in CI, plus manual screen-reader tests in LTR and RTL. Produce an ACR (VPAT) per release.

## Module: incident

### Features
- **Standards-complete incident record** — Fields:
  - People and scope: caller and affected user, channel, affected service and CI (from CMDB), category/subcategory.
  - Priority: impact, urgency, computed priority (matrix version recorded), override reason.
  - Ownership: assignment group, assignee, provider (SIAM).
  - Lifecycle and SLA: state, SLA clocks, timestamps (reported, logged, acknowledged, first response, resolved, closed, reopened).
  - Resolution: workaround, resolution notes, resolution and cause codes.
  - Links and flags: problem, change, KB article, related incidents; major-incident flag; security-incident flag; regulatory flags; satisfaction result.

  Every state change requires a work note, because "records shall be updated with actions taken". [ISO/IEC 20000-1 §8.6.1; COBIT DSS02.02; FitSM-1 v3.0 PR9; FitSM GR2.3 "execution of key activities recorded"]
- **Lifecycle** — New → Assigned → In progress ⇄ On hold/Pending (reason codes: awaiting user, awaiting supplier/provider, awaiting change, awaiting problem) → Resolved → Closed (auto-close after a configurable confirmation window); Cancelled; Reopened within a window. Pending reasons control SLA pause. [ISO/IEC 20000-1; FitSM-1 v3.0 PR9.5 consistent closure]
- **Consistent registration, classification and prioritisation** — Required classification at logging, priority from impact × urgency that takes SLA targets into account, and consistency checks such as a mandatory category/CI pair. [FitSM-1 v3.0 PR9.1; ISO/IEC 20000-1 §8.6.1; COBIT DSS02.01–.02]
- **Functional and hierarchical escalation** — Rule- and time-based reassignment to higher support tiers or providers, management escalation by priority and SLA risk, and consistent escalation criteria. [FitSM-1 v3.0 PR9.3; COBIT DSS02.04; ISO/IEC 20000-1 "escalated if needed"]
- **User progress information** — Automatic and manual updates to the reporter on every significant change, with a portal timeline. [FitSM-1 v3.0 PR9.4]
- **Access to supporting information** — From the incident form, handlers reach known errors, workarounds, configuration and release information, the change calendar and similar incidents. [FitSM-1 v3.0 PR9.2 (resolve using SLA and known-error information); ISO/IEC 20000-1 §8.6.3]
- **Major incident management** — Built on:
  - Documented major-incident criteria evaluated automatically (priority, service tier, user count, regulatory flag).
  - A documented major-incident procedure as a task template.
  - A nominated major-incident manager with authority, and automatic top-management notification.
  - Bridge/war-room link, communications cadence timers, status page posts.
  - A major-incident review and report after service restoration.

  SRE incident command roles are available: Incident Commander, Operations Lead, Communications Lead, Planning Lead and scribe. They come with a "live incident state document" and an explicit, logged command handover. [ISO/IEC 20000-1 §8.6.1; FitSM-1 v3.0 PR9.6 and FitSM-2 major-incident activities (major incident coordinator, major incident review); Google SRE "Managing Incidents"]
- **Security-incident path** — Information-security events and incidents are managed through the incident procedure, prioritised by information-security risk.
  - ISO/IEC 27035-1:2023 phases: plan & prepare; detect & report; assess & decide; respond; learn lessons.
  - ISO/IEC 27001 A.5.24–A.5.28: planning & preparation, assessment & decision on events, response, learning, collection of evidence; A.6.8 event reporting by staff.
  - NIST SP 800-61r3 mapped to CSF 2.0: RS.MA-01 plan executed with relevant third parties; RS.MA-02 reports triaged & validated; RS.MA-03 categorised & prioritised; RS.MA-04 escalated; RS.MA-05 criteria for initiating recovery applied; RS.AN-03 analysis to establish what happened and the root cause; RS.AN-06/07 investigative actions and data recorded with integrity and provenance preserved; RS.AN-08 magnitude estimated and validated; RS.MI-01/02 contained and eradicated; RS.CO-02/03 stakeholders notified and information shared.

  [ISO/IEC 20000-1 §8.7.3.3; ISO/IEC 27035; NIST SP 800-61r3]
- **Regulatory clock engine** — A `regulatory_case` attached to one or more incidents, one case per regime:
  - **EU DORA**: classification assistant with the Delegated Reg. 2024/1772 criteria (clients/financial counterparts/transactions affected, reputational impact, duration and service downtime, geographical spread, data losses, criticality of services affected, economic impact). Major ≈ critical services affected plus either malicious unauthorised access with potential data loss or thresholds of two other criteria met (verify thresholds against the RTS). Deadlines per Del. Reg. 2025/301: initial notification as early as possible, within 4 h of classification as major and no later than 24 h after awareness; intermediate report within 72 h of the initial notification; final report within 1 month of the latest intermediate report. Clients informed without undue delay when their financial interests are affected (Art. 19(3)). Voluntary notification of significant cyber threats.
  - **NIS2** Art. 23: early warning within 24 h of awareness; incident notification within 72 h; final report within 1 month of the notification, or a progress report and a final report within 1 month of handling if still ongoing. 24 h notification for trust service providers.
  - **GDPR**: Art. 33 notification to the supervisory authority within 72 h; Art. 34 communication to data subjects for high risk.
  - **US SEC** Form 8-K Item 1.05: 4 business days after the materiality determination.

  The engine also holds report templates per regime, a submission log (content snapshot, submitted at, reference number, acknowledgement) and countdown timers in calendar time (business days for the SEC). [EU DORA Art. 17–19; NIS2 Art. 23; GDPR Art. 33–34]
- **Recurring-incident aggregation** — Detects incidents with the same apparent root cause (same CI, cause code or embedding cluster) within a rolling window and raises a problem candidate. Under EU DORA, recurring incidents that are individually non-major (≥2 within 6 months with the same apparent root cause; verify against the RTS) are assessed collectively for major classification. [ISO/IEC 20000-1 §8.6.3; EU DORA RTS]
- **Evidence and chain of custody** — Hashed attachments (SHA-256), append-only custody log (handler, time, action, purpose, storage location), legal hold, and export with integrity proofs. [ISO/IEC 27001 A.5.28; NIST CSF RS.AN-06/07]
- **Stakeholder and public communications** — Internal and external communications log, approved templates, approval of public statements, a status page with subscriptions, and public recovery updates through approved channels. [NIST CSF RS.CO-02/03, RC.CO-03/04; EU DORA Art. 14]
- **KCS-integrated handling** — Search runs from the incident form ("search early, search often"). The search string and captured context pre-frame a WIP article ("searching is creating"). Linking an article counts toward link rate. Handlers can flag an article or fix it in place, and the incident and the article version used are recorded. [KCS v6 T1.1–1.3, T3.1–3.3, T4.2]
- **Swarming option** — Cases can be routed to a swarm (a dispatch board) instead of tiered escalation. This follows the Consortium for Service Innovation's Intelligent Swarming model, which complements KCS. [Consortium for Service Innovation]
- **Closure and experience capture** — User confirmation, then a post-resolution survey: 0–10 rating, perceived lost time and "what influenced your experience" factors. Transactional satisfaction feeds HDI customer-satisfaction evidence. [HappySignals XLA; HDI Customer Satisfaction category]
- **SIAM cross-provider incidents** — The service integrator owns the end-to-end incident. Provider tickets are linked via e-bonding with status and comment sync; time-with-provider segments are measured against provider OLAs and SLAs; anti-ping-pong rules cap reassignment hops between providers. Disputes go to a SIAM process forum. [SIAM BoK]
- **Incident reporting** — Volumes and trends by service, CI, category and channel; backlog ageing; SLA compliance; mean time to acknowledge and resolve by priority; first-contact resolution; reopen rate; reassignment hops; major-incident count and duration; % incidents with linked KB; regulatory deadline compliance. [COBIT DSS02.07; ISO/IEC 20000-1 §9.4; HDI Performance Results]
- **AI assistance** — Auto-classification, routing and priority suggestions with rationale [AI]; similar incidents and known errors [AI]; early major-incident detection from ticket bursts and event correlation [AI]; summaries for handover, executive updates and postmortems [AI]; a regulatory classification assistant that pre-fills EU DORA/NIS2/GDPR criteria from incident data for human confirmation [AI].

### Implementation notes
- **Priority.** Compute `priority = matrix_version.lookup(impact, urgency)` and persist both the computed and final priority, plus override reason and actor.
- **Regulatory deadlines** are rules over timestamps, e.g. `dora.initial_due = min(classified_major_at + 4h, aware_at + 24h)`, `dora.intermediate_due = initial_submitted_at + 72h`, `dora.final_due = last_intermediate_submitted_at + 1 month`. Capture `aware_at` and `classified_at` as explicit, user-confirmed fields, since they are legal facts, not system defaults. One incident can carry several regimes at once (GDPR + NIS2 + EU DORA).
- **Major-incident criteria** live as versioned rules. Store the evaluation result and criteria snapshot on the incident. A "postmortem required" flag is set by policy (major incident, data loss, regulatory case).
- **SIAM e-bonding.** Use a correlation ID per external ticket and assign each field an owner (integrator or provider) to prevent update loops. Queue outbound updates with retry and idempotency keys, and reconcile periodically.
- **KCS link table:** `(incident_id, article_id, article_version_id, link_type: resolved_by|related|created_from, linked_by, linked_at, accuracy_sample_result)`.

## Module: problem

### Features
- **Problem record** — ID, problem statement, affected services and CIs, category, impact/priority, problem manager, assignment group, linked incidents (count and list), linked events and alerts, linked changes (fix and cause), workaround with effectiveness, root cause (text plus cause taxonomy), RCA method, known-error records, resolution, closure code and effectiveness-review date. [ISO/IEC 20000-1 §8.6.3; COBIT DSS03.01–.05; FitSM-1 v3.0 PR10.1–10.4]
- **Lifecycle** — New → Assessed/prioritised → Root-cause analysis → Known error (root cause identified, not permanently resolved; workaround documented) → Fix in progress (change raised under the change policy) → Resolved (fix deployed; monitoring period) → Closed. Alternative exits: Cancelled or Duplicate. Escalation applies "if needed". [ISO/IEC 20000-1 §8.6.3]
- **Proactive problem management** — Scheduled analysis of incident data and trends (by CI, service, category, cause code, time of day, change correlation), event patterns, KCS reuse patterns (Knowledge Domain Analysis), error-budget consumption and vulnerability findings. [ISO/IEC 20000-1 "analyse data and trends on incidents to identify problems"; COBIT DSS03.05; KCS T5.9]
- **Known Error Database** — Known errors are recorded; up-to-date known errors and problem resolutions are visible to incident and request handlers and, per audience, to self-service as KCS articles. Each known error carries a workaround, its effectiveness rating and an expiry/review date. [ISO/IEC 20000-1 §8.6.3; COBIT DSS03.03 "raise known errors"; FitSM-1 v3.0 PR10.3–10.4]
- **Impact reduction when no permanent fix exists** — Required actions to reduce or eliminate impact: workaround, monitoring, temporary capacity, user communication. [ISO/IEC 20000-1 §8.6.3]
- **RCA toolkit** — 5 Whys, Ishikawa/fishbone, fault tree, Kepner-Tregoe IS/IS-NOT, timeline reconstruction from events, changes and incidents, and change-correlation view. The CMMI Causal Analysis & Resolution cycle is supported: select outcomes for analysis → analyse causes → propose and implement actions → evaluate the effect → record data. [CMMI V3.0 CAR; COBIT DSS03.02]
- **Blameless postmortems** — Template: title, date, authors, status, summary, impact, root causes, trigger, detection, resolution, action items, lessons learned (what went well / what went wrong / where we got lucky), timeline, supporting information. Action items are typed (prevent, mitigate, detect, repair), each with owner, priority and tracker link.
  - Configurable triggers: user-visible downtime or degradation beyond a threshold; any data loss; on-call intervention (rollback, traffic reroute); resolution time above a threshold; monitoring failure (manual discovery); one incident consuming >20% of the 4-week error budget.
  - Review and publication workflow; searchable postmortem repository.

  [Google SRE book ch. 15; SRE Workbook error-budget policy]
- **Effectiveness review** — Recurrence monitoring after a fix (incidents linked to the same problem or known error after the fix date), with periodic reporting. [ISO/IEC 20000-1 "effectiveness of problem resolution shall be monitored, reviewed and reported"]
- **Lessons-learned register** — Lessons from incidents, problems, exercises and tests feed the improvement register. [ISO/IEC 27001 A.5.27; NIST CSF ID.IM-02/03; EU DORA Art. 13 post-incident reviews]
- **Cross-provider problem management** — A SIAM process forum for problem management, joint RCA sessions, provider-assigned action items with due dates and tracking, and shared known errors across providers. [SIAM BoK]
- **AI assistance** — Incident clustering into candidate problems [AI]; RCA hypotheses from correlated changes, events and CI-graph proximity [AI]; postmortem drafting with blameless-language linting [AI]; known-error and workaround article drafting in KCS structure [AI].

### Implementation notes
- Model `known_error` as a separate record linked 1:n to `problem` (several workarounds or KEs per problem). Publishing a KE creates or links a KCS article with audience and confidence.
- **Clustering.** Build embeddings of incident short description + description + resolution, plus structured features (CI, service, category, hour). Run HDBSCAN nightly over rolling 30/90-day windows. Surface clusters above size and density thresholds as suggestions, and require a human to create the problem (AI Act human oversight; avoids noise).
- **Recurrence KPI:** `recurrence_rate = incidents linked to a problem with opened_at > fix_deployed_at within N days`.
- A postmortem cannot be published until every "prevent"-type action item has an owner. Dashboards show postmortem action-item closure rate and age.

## Module: change

### Features
- **Change-management policy object** — A versioned policy that defines:
  - the service components and other items under change control
  - change categories, including emergency, and how each is managed
  - criteria for changes with potential major impact on services or customers

  Major-impact changes (new services, service removal, transfer of a service) are routed to service design & transition. The policy version drives workflow configuration. [ISO/IEC 20000-1 §8.5.1.1; FitSM-1 v3.0 PR12.1–12.2]
- **Request for change (RFC) record** — Fields:
  - Origin and content: requester, originating record (incident, problem, request, release, pipeline), reason/business justification, description.
  - Scope and type: affected CIs and services, change category/model.
  - Assessment: risk assessment (questionnaire + model score), impact (business, technical, security, financial, customer, SLA, regulatory/conformity), benefits, technical feasibility, cost.
  - Plans and approval: implementation plan, test plan and results, remediation/backout plan (tested? yes/no + evidence), change authority and approvals.
  - Schedule: planned start/end, actual start/end.
  - Outcome: successful / successful with issues / failed / backed out, PIR result, links to incidents caused.

  [ISO/IEC 20000-1 §8.5.1.2–8.5.1.3; COBIT BAI06.01; PCI DSS 4.0.1 6.5.1]
- **Change models** — Standard (pre-authorised template, low risk, repeatable; reviewed periodically), Normal (assessed and authorised by the risk-tiered change authority), Emergency (expedited authority, retrospective documentation and review), plus a "major" path. USM routes standard service requests through its Change process. [COBIT BAI06.02 "manage emergency changes"; USM]
- **Decision-making evidence** — Risk, business benefit, technical feasibility and financial impact are mandatory before authorisation, along with impact on CIs, services, customers, SLAs and conformity to requirements. CMDB impact analysis (up/downstream services, business processes, critical or important functions under EU DORA) is shown. The decision record keeps its rationale. [ISO/IEC 20000-1 §8.5.1.3]
- **Change authority & CAB** — Authority levels by risk: peer, team lead, CAB, ECAB, business owner. Includes CAB agendas, minutes, attendance, votes and decisions. A SIAM integrated CAB includes provider representatives with visibility of cross-provider changes. DORA-metrics research favours *streamlined change approval*: peer review plus automated testing in the delivery pipeline instead of external CAB approval for routine changes, so the tool must support pipeline-evidence-based approval. [DORA capabilities; SIAM BoK]
- **Change schedule** — Forward schedule of change, blackout/freeze and maintenance windows per service and CI, holiday freezes, and publication of planned deployment dates to stakeholders and the service desk. [ISO/IEC 20000-1 "dates for deployment ... planned and communicated"]
- **Remediation planning & testing** — Remediation or reversal is planned and, where possible, tested before approval. Unsuccessful changes are reversed or remediated and the outcome recorded. [ISO/IEC 20000-1 §8.5.1.3]
- **Post-implementation review** — An effectiveness review for every change, with a mandatory PIR for failed, emergency and major changes. [ISO/IEC 20000-1; COBIT BAI06.04, BAI07.08]
- **Change trend analysis at planned intervals** — Success and failure rates, emergency share, backlog, approval cycle time, changes causing incidents and unauthorised changes. Results feed improvement opportunities. [ISO/IEC 20000-1 "change records shall be analysed at planned intervals to detect trends"; COBIT BAI06.03]
- **Unauthorised-change detection** — Discovered configuration changes are reconciled against approved change windows and CIs. Mismatches create an incident or a nonconformity. [COBIT BAI10.05; ISO/IEC 27001 A.8.9; NIST CSF ID.RA-07 "changes and exceptions are managed, assessed for risk impact"]
- **Error-budget gate** — When a service's SLO error budget is exhausted over the policy window, non-exempt changes to that service are blocked. P0 bug fixes and security fixes are exempt, and the rule is configurable per the error-budget policy. [Google SRE Workbook]
- **Regulated change controls** — EU DORA ICT change management (Art. 9(4)(e)); ISO/IEC 27001 A.8.32 change management, A.8.31 separation of environments, A.8.29 security testing, A.8.19 software installation; SOC 2 CC8.1 (authorised, designed, developed, configured, documented, tested, approved, implemented); PCI DSS 4.0.1 6.5.1–6.5.2 (reason, security impact, authorisation, testing, backout; PCI requirements re-confirmed after significant change).
- **Change metrics** — Change fail rate and deployment rework rate (DORA metrics), lead time from request to deploy, emergency %, % with PIR, % causing incidents, standard-change usage %. [DORA metrics; ISO/IEC 20000-1]
- **AI assistance** — Risk scoring and success prediction with explanation [AI]; collision and conflict detection [AI]; CAB briefing summaries [AI]; drafted implementation, test and backout plans from similar past changes [AI]; impact narrative from the CMDB graph [AI].

### Implementation notes
- **Risk.** Combine a rules questionnaire (policy-mandated) with an ML model over features: CI criticality, historical failure rate of the CI/template/team, number of CIs, change size (lines, artefacts), test coverage, time window, concurrent changes, recent incidents. Persist score, model version and top factors on the change (ISO/IEC 42001 A.6.2.8). A human authority decides; the AI may only auto-approve standard or pre-authorised models when policy allows.
- **Collision detection.** Interval-overlap query on the same CI or within the n-hop dependency subgraph, plus blackout-window checks.
- **Pipeline integration.** CI/CD posts deployment intents with evidence (peer-review ID, test results, artefact digest, SBOM). Policy decides between auto-approve (standard/low-risk) and creating a normal change. Every production deployment yields a change record, giving the complete population for SOC 2 sampling and DORA-metrics computation.
- **Change fail rate:** changes (deployments) needing immediate remediation ÷ total. **Deployment rework rate:** unplanned deployments caused by production incidents ÷ total deployments. Tag deployments as `planned` or `unplanned_remediation`, linking to the incident.

## Module: release

### Features
- **Release & deployment policy** — Release types (major, minor, emergency, patch), release frequency and windows, emergency release procedure. [ISO/IEC 20000-1 §8.5.3]
- **Release record** — Release ID/version; scope (changes, work items, CIs); release package and artefacts (build-package references, digests, signatures, SBOM); acceptance criteria and test evidence; deployment plan per environment/target; rollback plan; release-readiness approval; go/no-go decision; per-target deployment status; early-life-support window; outcome (success/failure) and lessons. [ISO/IEC 20000-1 §8.5.3; COBIT BAI07; IT4IT R2D data objects: Service Release, Service Release Blueprint, Build Package, Test Case, Defect]
- **Service design & transition for major changes** — Plan: authorities, activities and timescales, human/technical/information/financial resources, dependencies, testing, service acceptance criteria, measurable intended outcomes. Design: responsibilities, resource changes, training needs, new/changed SLAs and contracts, SMS changes. Build & transition: test against requirements, design and acceptance criteria; update the service catalogue; report results against intended outcomes. [ISO/IEC 20000-1 §8.5.2.1–8.5.2.3; FitSM-1 v3.0 PR1.3 (plans consider timescales, responsibilities, technology, communication, service acceptance criteria)]
- **Acceptance testing & environments** — Implementation plan, conversion plan, acceptance test plans, test environment booking, test-data controls, separation of environments. [COBIT BAI07.01–.05; ISO/IEC 27001 A.8.31, A.8.33]
- **Release readiness review / go-no-go** — Checklist covering tests passed, operations and support readiness, KB articles, monitoring, rollback rehearsed, comms, approvals. [MOF 4.0 Release Readiness management review; COBIT BAI07.06]
- **Early life support** — A heightened support window with tagging of incidents to the release. [COBIT BAI07.07]
- **Success/failure analysis & publication** — Success and failure are monitored and analysed. Results and future release dates are published to incident and service-request management. [ISO/IEC 20000-1 §8.5.3]
- **Artefact library / DML** — Authorised, signed artefacts with SBOM (SPDX 3.0, CycloneDX) and provenance, linked to CIs on deployment. [ISO/IEC 27001 A.8.25–8.30; NIST CSF PR.PS-06]
- **Deployment metrics** — Deployment frequency, change lead time, failed deployment recovery time (DORA metrics); release on-time %, release defect leakage.
- **AI assistance** — Release-note generation from linked work items [AI]; readiness risk assessment from test, defect and change history [AI].

### Implementation notes
- IT4IT 3.0 separates **Deploy** (put a release into production) from **Release** (make it available to consumers through offers/subscriptions). Model `deployed_at` and `released_at` separately; feature flags make this distinction real.
- A release groups changes, and each production deployment event produces a linked change record of model `release-deployment`. CMDB CI versions update on deployment success, satisfying "configuration information shall be updated following the deployment of changes" (20000-1 §8.2.6).

## Module: request

### Features
- **Service request record** — Fields:
  - People: requester, requested-for (can differ, e.g. a manager ordering for a new hire), cost centre.
  - What: catalogue item/offer and version, quantity, item variables (form answers), attachments, justification.
  - Control: approvals (per item policy), entitlement-check result, SLA/target date, priority.
  - Work: fulfilment tasks (per group or provider), work notes, actual delivery date, charge (if showback/chargeback), closure code, satisfaction result.

  ISO/IEC 20000-1 §8.6.2 requires requests to be recorded and classified, prioritised, fulfilled and closed. Records must be updated with actions taken, and fulfilment instructions must be available to the people doing the work. [ISO/IEC 20000-1 §8.6.2; FitSM-1 v3.0 PR9.1–9.5; COBIT DSS02.02–.03, DSS02.06]
- **Lifecycle** — Submitted → Awaiting approval → Approved | Rejected → In fulfilment (parallel/serial tasks) → Fulfilled/Delivered → Closed. Side states: Cancelled, Backordered/Awaiting stock, Partially fulfilled. Closure includes user confirmation where the policy demands it. [FitSM-2 ISRM closure procedure]
- **Verify–approve–fulfil** — Three checks before work starts: the requester is entitled (catalogue audience, contract entitlement, licence availability); approvals follow policy (financial, security, data owner); the item has a defined fulfilment procedure. [COBIT DSS02.03 "Verify, approve and fulfil service requests"]
- **Standardised request workflows** — Each catalogue item links to its fulfilment workflow and work instructions. FitSM-2 tells the provider to identify standard requests from service descriptions and SLAs and to "maintain workflows for standardised service requests". Requests that need a change raise one; a pre-authorised standard-change model is the usual mechanism. FitSM lists "requests for changes raised … to commence the fulfilment of service requests" as an ISRM output, and USM handles standard requests as standard changes in its Change process. [FitSM-2 PR9; USM]
- **Access requests and joiner-mover-leaver** — Access is provisioned through a formal request:
  - Flow: the resource owner approves; segregation-of-duties conflicts are checked at request time; access is granted for a time window (start/end) with automatic expiry and revocation; the grant is recorded; periodic recertification follows.
  - Leaver flow: all access removed and all assets returned (asset checklist from ITAM).
  - Mover flow: old access revoked when the new access is granted.

  [ISO/IEC 27001 A.5.15–5.18, A.5.11, A.6.5; FitSM-1 v3.0 PR6.5 "access control, including provisioning of access rights … consistent"; COBIT DSS05.04; NIST CSF PR.AA-01/-05]
- **Software requests with licence check** — Before deployment the request is checked against the effective licence position. If no licence is free, harvesting is offered or procurement is triggered, and the deployment is recorded against the entitlement. [ISO/IEC 19770-1/-3; COBIT BAI09.05]
- **Orders, subscriptions and usage** — The IT4IT Request-to-Fulfill (R2F) model, called the Consume value stream in IT4IT 3.0, works as follows:
  - A consumer selects a **Service Offer** from the **Offer Catalog** into a **Shopping Cart**.
  - Request rationalisation splits the order into **Fulfillment Requests** for each provider or engine.
  - Fulfilment creates or updates a **Subscription** (states: requested, active, modified, suspended, cancelled/expired).
  - **Usage Records** feed **Chargeback/Showback**.
  - The Subscription is the anchor for "what does this person/department consume?"

  [IT4IT 2.1 R2F; IT4IT 3.0 Release/Consume]
- **Kanban queues for fulfilment teams** — Boards with columns per workflow step, explicit policies per column (entry/exit criteria), WIP limits per column or swimlane, and classes of service with their own policies (Expedite, Fixed date, Standard, Intangible). Blocked flags record a reason and blocked time. Replenishment and service-delivery-review cadences are scheduled events. [Kanban Method; Kanban University]
- **Service level expectations (SLE)** — For each item or class of service, a probabilistic expectation such as "85% of laptop requests delivered within 5 business days". It is derived from the historical cycle-time distribution and shown to requesters at order time, alongside contractual SLA targets. [Kanban flow metrics]
- **Cross-provider fulfilment** — The service integrator decomposes a request into provider tasks (e-bonded to provider tools), each with its own OLA/contract target, while measuring the end-to-end target. [SIAM BoK; ISO/IEC TS 20000-14:2023]
- **Data minimisation on forms** — Item variables are tagged as personal data or special-category data with a retention class. Forms collect only what fulfilment needs, and special-category answers are masked after fulfilment. [GDPR Art. 5(1)(c), 25]
- **Request reporting** — Volumes by item, channel and requester org; fulfilment time against SLA and SLE (percentiles, not only averages); approval cycle time; backlog and work-item age; automation rate (zero-touch fulfilment %); cost per request; reopen rate; satisfaction and perceived lost time. [COBIT DSS02.07; FitSM PR3; HappySignals; Kanban]
- **AI assistance** — Free-text intent to catalogue-item matching and form pre-fill [AI]; approval recommendations with rationale (the human approver decides) [AI]; agentic fulfilment of low-risk items (password/MFA reset, group membership, software install) behind policy gates and an audit trail [AI]; SLE breach prediction from current WIP and age [AI].

### Implementation notes
- **Three levels of record:** `request` (order header) → `request_item` (one per item/quantity; holds variables, approvals, SLA) → `fulfilment_task` (one per assignment group/provider/automation). Approvals attach at item level, because one cart can mix pre-approved and approval-required items.
- **Entitlement rules** are predicates over (requester attributes, item, contract, stock/licence pool). Evaluate them at display time (to hide items) and again at submit time. A requester's attributes can change between browsing and ordering.
- **Access grants** are first-class records: `access_grant(subject, resource, role, granted_by_request, approver, valid_from, valid_to, status)`. A nightly reconciliation compares grants with the target system (via SCIM/connector) and raises exceptions for orphaned or excess access. Recertification campaigns iterate over grants, not over requests.
- **SLE computation:** keep cycle times per (item, class of service) over a rolling window and publish the 50th/85th/95th percentiles. Do not average across classes of service.

## Module: knowledge

### Features
- **KCS article structure** — Fields:
  - Issue, in the requestor's words.
  - Environment: products, versions and recent changes, using standard naming; it does not change after resolution.
  - Resolution, with numbered steps.
  - Cause and Cause test (optional; distinguish similar issues).
  - A restricted **Internal Resolution** field hidden from requestors even on external articles; if the tool cannot hide fields, a linked "internal use only" article is used instead.

  Metadata the system adds automatically: dates, timestamps, versions, reuse counts, creator and modifier identities. Metadata the knowledge worker sets: audience, quality and governance. Articles stay modular (about a page) and hold no requestor-specific data (company names, contacts, entitlements), which belongs in the case. [KCS v6 Technique 5.1]
- **Article state (three fields)** —
  - **Confidence**: Work in Progress (framed issue, no resolution yet) → Not Validated (resolution but low confidence or not compliant with the content standard) → Validated (reusable, content-standard compliant) → Archived (out of search and browse, still reachable from linked incidents and advanced search, restorable to any state).
  - **Audience**: Internal, Within a Domain (product, topic, job function, department), Partners, Customers (registered self-service), Public (search-engine optimised); anything wider than Internal counts as External.
  - **Governance**: Experience-based (any licensed member) or Compliance-based (only designated people edit policy, regulatory or legal content; everyone can comment).

  An **Article State Matrix** combines audience × confidence × knowledge domain into visibility rules (e.g., partners and customers see only Validated). [KCS v6 Technique 5.2]
- **WIP handling** — A WIP article is created at or near the first search on an issue and lives only while the incident is open. At closure:
  - if an existing article solved the issue, the WIP is deleted;
  - if the issue was resolved, the WIP is completed and moved to Not Validated or Validated;
  - if unresolved, the WIP is deleted or archived unless it holds reusable information.

  WIPs stay searchable to prevent duplicate work. [KCS v6 T5.2, T1.3 "Searching is creating"]
- **Licence-based rights** —
  - **KCS Candidate**: edits own articles, drafts WIP or Not Validated articles, links and flags; cannot validate or publish; a Coach reviews their work.
  - **KCS Contributor**: creates and validates articles in their area without review; approves broad internal visibility; edits Internal articles; flags External articles.
  - **KCS Publisher**: sets audience to External and edits External content; can flag External content for archive or deletion.
  - **KCS Coach**: reviews Candidate articles and validates internally.
  - **Knowledge Domain Expert** (not a licence): owns domain content health.
  - **KCS Council**: cross-functional body of coaches, KDEs and managers, meeting about every two weeks.

  Licences are not tied to job grade. They are earned through training, demonstrated competency (Content Standard Checklist and Process Adherence Review results), an exam and often a coach recommendation, are renewed periodically and can be revoked. [KCS v6 T7.1, Appendix D]
- **Publishing models** — Just-in-time publishing by licensed staff. The mature-state target is **"90/0"**: 90% of articles available externally at or before case closure. Transitional options: auto-publish after a reuse threshold, or a "conveyor belt" where an article goes External after three internal reuses unless someone intervenes within five days. [KCS v6 T5.2]
- **Solve Loop in the workflow** —
  - Capture: in the moment (T1.1), in the requestor's context (T1.2); searching is creating (T1.3).
  - Structure: simple template (T2.1); complete thoughts, not complete sentences (T2.2).
  - Reuse: search early and often (T3.1); seek to understand what we collectively know (T3.2); linking (T3.3).
  - Improve: reuse is review (T4.1); flag it or fix it (T4.2); licence to modify (T4.3).

  All of this runs from the incident or case form. [KCS v6 Practices 1–4]
- **Evolve Loop tooling** —
  - Content standard (T5.3): a documented standard with a **Content Standard Checklist** (formerly AQI); yes/no checks on sampled articles per contributor, e.g. unique (not a duplicate), complete, clear, title reflects issue, correct metadata/audience; exact item list unverified.
  - Article types and lifecycle: Evolve-loop articles from pattern analysis (T5.4), archiving (T5.5), legacy-data import (T5.6), priming for new products (T5.7), global/translation support (T5.8).
  - Analysis and measures: **Knowledge Domain Analysis** of reuse and link patterns to find top issues and problem candidates (T5.9); content health indicators (T5.10); self-service success and measures (T5.11–5.12).
  - Process integration: closed-loop feedback routing flags to owners (T6.4).

  [KCS v6 Practice 5–6]
- **Process Adherence Review (PAR)** — A coaching instrument computed from samples:
  - **Link rate**: closed cases with a linked article ÷ closed cases. This is an activity measure with no goal; 60–80% is sufficient to see reuse patterns.
  - **Link accuracy**: share of links that are actionable, specific and relevant. This is an outcome measure with a 90% benchmark; some organisations give no link-rate credit below it.
  - **Modify rate**: modified ÷ reuses that warranted modification.
  - **Create rate**: (created − duplicates) ÷ create opportunities.
  - **Contribution Index**: (valid created + modified + linked − duplicates) ÷ (create opportunities + modify opportunities + KB potential).
  - Search timing and frequency per case.

  The approach was refreshed as **PAR 2.0** in July 2025. KCS guidance: never set goals on activity metrics, only on outcomes. [KCS v6 T6.5, T7.3]
- **Knowledge as an SMS requirement** — The organisation determines and maintains the knowledge needed to operate the SMS and services, keeps it relevant and available to appropriate persons, and makes known errors and problem resolutions available to incident handlers. COBIT BAI08 adds: identify and classify sources (BAI08.01), organise and contextualise information into knowledge (BAI08.02), use and share (BAI08.03), evaluate and update or retire (BAI08.04). [ISO/IEC 20000-1 §7.6, §8.6.3; COBIT 2019 BAI08]
- **Knowledge-management-system alignment** — ISO 30401 (KM systems requirements) covers knowledge development (acquisition, application, retention, handling outdated knowledge), knowledge conversion (socialisation, externalisation, combination, internalisation) and KM enablers (human capital, processes, technology and infrastructure, governance, culture). The tool provides the records for these through the MS kernel. [ISO 30401:2018 (current-edition status unverified)]
- **Compliance-based articles as controlled documents** — Policy and regulatory articles follow documented-information control: approval, review date, version history and distribution. [ISO/IEC 20000-1 §7.5; ISO/IEC 27001 §7.5; KCS governance attribute]
- **Feedback, flags and ratings** — "Did this help?" with reason, flag reasons (incorrect, outdated, unclear, duplicate), an owner work queue and flag-age SLA. Self-service success = sessions in which the user found an answer and did not open a case (survey-based or inferred). [KCS T5.11–5.12, T6.4]
- **Search** — Federated search over KB, known errors, catalogue and community. Synonyms, typo tolerance, relevance feedback from link events, and search analytics (zero-result queries, abandoned searches). [KCS T6.3]
- **Privacy and AI provenance** — PII scan before publishing beyond Internal, since requestor-specific data must stay in the case. AI-drafted or AI-translated articles carry provenance metadata (model, prompt source, reviewer) and a visible label until a licensed human validates them. [GDPR Art. 5(1)(c); KCS T5.1; EU AI Act Art. 50(2) marking duty of GenAI providers; ISO/IEC 42001 A.8]
- **AI assistance** — Article drafting in KCS structure from a resolved incident, chat or call transcript [AI]; duplicate and near-duplicate detection at creation [AI]; automatic Content Standard Checklist pre-scoring for coaches [AI]; knowledge-gap detection by clustering zero-result searches and unlinked resolved incidents [AI]; generative answers grounded in permitted articles, with citations [AI]; machine translation with human validation [AI].

### Implementation notes
- **Schema.** `article(id, domain_id, governance)` → `article_version(id, article_id, issue, environment, resolution, cause, cause_test, internal_resolution, confidence, audience, created_by, created_at, ai_provenance)`; `article_link(case_type, case_id, article_version_id, linked_by, linked_at, link_type)`; `article_flag(article_id, reason, raised_by, status)`; `kcs_licence(user_id, level, domain_id, granted_at, expires_at, revoked_at)`; `par_sample(...)`. Reuse count = count of links (by case), not page views.
- **Rights enforcement.** Transition guards check the actor's KCS licence level for the article's domain, not their ITSM role. "Validated + External" requires Publisher, or the reuse-threshold or conveyor-belt policy firing.
- **Search security.** Index each version with ACL tokens (audience, domain, entitlement groups, company/domain separation). Filter queries by the caller's tokens before ranking, so neither snippets nor AI answers leak restricted fields; the Internal Resolution field gets a separate token.
- **90/0 metric** = articles created in the period whose `audience ∈ External` at or before the linked case's closure ÷ articles created.

## Module: cmdb

### Features
- **Minimum CI record** — ISO/IEC 20000-1 requires, for every CI: unique identification, CI type, description, relationships with other CIs, and status. CI types must be defined, and services are classified as CIs. The level of detail must suit the criticality and type of service. Access to configuration information must be controlled. CI changes must be traceable and auditable, and configuration information must be updated after deployment of changes. [ISO/IEC 20000-1 §8.2.6]
- **Scope definition** — Configuration-management scope with CI types and relationship types in scope, a CI owner per CI, and level-of-detail rules per CI type. [FitSM-1 v3.0 PR11.1–11.3; FitSM-3 "CI owner" case-owner role]
- **Configuration model, repository and baselines** — Class model (configuration model), repository, approved baselines (e.g., release, golden image, security baseline), status accounting and configuration reports. [COBIT BAI10.01–10.04]
- **Planned verification and audit** — Accuracy is verified at planned intervals, by sampling or full reconciliation against discovery and physical audit. Deficiencies create corrective tasks. Results are kept as evidence, with a CMDB-accuracy KPI per class. [ISO/IEC 20000-1 §8.2.6; FitSM PR11.5; COBIT BAI10.05]
- **Security configuration baselines** — Security configurations of hardware, software, services and networks are established, documented, implemented, monitored and reviewed. CIs carry a baseline reference and a compliance status, and drift raises an incident or a change. [ISO/IEC 27001 A.8.9; NIST CSF PR.PS-01]
- **Asset inventory with owners** — Inventory of information and other associated assets, each with an owner; classification and labelling. [ISO/IEC 27001 A.5.9, A.5.12–5.13]
- **NIST CSF inventories** — The CMDB/ITAM pair implements:
  - ID.AM-01 hardware and ID.AM-02 software, services and systems inventories;
  - ID.AM-03 authorised network communications and data flows;
  - ID.AM-04 services provided by suppliers;
  - ID.AM-05 prioritisation by classification, criticality and impact;
  - ID.AM-07 data inventories and metadata;
  - ID.AM-08 lifecycle management.

  [NIST CSF 2.0 ID.AM]
- **EU DORA ICT asset mapping** — Requirements:
  - Identify, classify and document ICT-supported business functions, information assets and ICT assets with their roles and dependencies, reviewed at least yearly.
  - Map the configuration of, and interdependencies between, information and ICT assets.
  - Identify processes dependent on ICT third-party service providers, especially those supporting **critical or important functions**.
  - Update inventories at each major change.
  - Run a yearly risk assessment of legacy ICT systems.

  The tool needs a "supports critical or important function" flag propagated over the dependency graph, and provider links on every CI. [EU DORA Art. 8 (paragraph details unverified)]
- **Service models** — Conceptual service (business view) → logical service blueprint → service release blueprint → desired topology → actual CIs, with traceability between them. The Digital Product and Service Offer are the 3.0 backbone. [IT4IT 2.1 Service Model; IT4IT 3.0 (object names unverified)]
- **Federation** — Federation of several management data repositories (provider CMDBs, cloud inventories, discovery tools) through registration and query services, with identification and reconciliation. In SIAM, each provider owns some attributes and the integrator holds the end-to-end service model and a shared data dictionary. [DMTF CMDBf 1.0; SIAM BoK; FitSM federation concept]
- **Software composition** — Per deployed software CI: links to an SBOM (SPDX 3.0 / ISO/IEC 5962, CycloneDX/ECMA-424), and through it to vulnerabilities (CVE/CSAF-VEX). [NIST CSF ID.AM-02; EU CRA]
- **Resilience attributes** — RTO/RPO/MTPD from the BIA, service tier, redundancy and backup relationships ("backed up by", "fails over to") and recovery site. These feed continuity planning and impact analysis. [ISO 22301 §8.2.2; ISO/IEC 27001 A.8.13–8.14]
- **CMDB health** — Completeness (required attributes populated), correctness (matches discovery), compliance (meets class rules and baselines), staleness (last discovered), duplicates, orphans (no relationships), and relationship coverage of critical services. [COBIT BAI10.05; FitSM PR11.2]
- **Configuration reports** — Status accounting (CIs by state and class), baseline vs actual diffs, CIs changed without an approved change, critical-function dependency maps, and provider dependency maps. [COBIT BAI10.04; EU DORA register-of-information support]
- **AI assistance** — Relationship inference from network flows and traces [AI]; duplicate-CI reconciliation by fuzzy matching [AI]; CI-class and owner suggestions [AI]; configuration-drift anomaly detection [AI]; natural-language querying of the service graph, filtered by the caller's permissions [AI].

### Implementation notes
- **Identification and reconciliation.** Identification rules per class use ordered candidate keys (serial + manufacturer; BIOS UUID; cloud resource ID; FQDN + IP). Reconciliation precedence is set per attribute per source (e.g., cloud API wins for size, HR wins for owner). Every attribute value stores its source and last-seen time.
- **CI status lifecycle:** Planned → On order → In build/test → Operational → Under maintenance/Degraded → Retired → Disposed. Only Operational CIs count for availability. Retired CIs keep their relationships (effective-dated) for history.
- **Effective-dated relationships** (`valid_from`, `valid_to`). Impact analysis for an incident at time T must use the graph as of T, since audits ask "what was affected then?".
- **Verification sampling.** Each cycle, draw a stratified sample per class, compare against discovery and physical evidence, and record matches and mismatches. Publish accuracy = matches ÷ sample, plus a confidence interval.
- **Critical-function propagation.** Store a computed `supports_critical_function` and `max_criticality` on each CI, recomputed incrementally when relationships change. EU DORA, BIA and change risk all read them.

## Module: itam

### Features
- **ITAM management system** — An ITAM system per ISO/IEC 19770-1:2017 (a discipline-specific extension of ISO 55001:2014; Amd 1:2024 adds climate action; reconfirmed 2024): ITAM scope (asset types and organisational scope), ITAM policy, objectives, plan, risks, roles, competence, documented information, audits and management reviews. It is built on the shared MS kernel. ISO/IEC TS 19770-10:2025 gives implementation guidance. [ISO/IEC 19770-1; ISO/IEC TS 19770-10]
- **Asset lifecycle** — Request → Approve → Procure → Receive → Deploy/Assign → Operate/Maintain → Redeploy | Retire → Sanitise → Dispose. Each step updates status, location, custodian and financial fields. Disposal requires secure deletion evidence (certificate of destruction or wipe report) and environmental disposal records. [COBIT BAI09.03; ISO/IEC 27001 A.7.14, A.8.10; ISO 55001 lifecycle]
- **Critical-asset management** — Assets flagged critical get maintenance plans, spares, support contracts and risk treatment. [COBIT BAI09.02; ISO 55001:2024 risk-based decision-making]
- **Value optimisation** — Utilisation analysis, refresh timing based on total cost of ownership, redeploy-before-buy, and harvesting of idle assets and licences. [COBIT BAI09.04; ISO 55000 value]
- **Licence management and effective licence position (ELP)** — For each product and metric, the ELP is entitlements − consumption. Consumption comes from installs, usage, users, cores or PVU, with product-use rights applied: downgrade, virtualisation, secondary use, dev/test, multiplexing. The ELP is snapshotted per period, with true-up and renewal forecasts. [COBIT BAI09.05; ISO/IEC 19770-3/-4]
- **SWID/CoSWID ingestion** — SWID tags:
  - Tag types: corpus, primary, patch, supplemental.
  - Identity: SoftwareIdentity name/version/tagId; Entity regid with roles (tagCreator, softwareCreator, licensor …).
  - Content: Evidence vs Payload (files, processes); Link relations (e.g., patches, requires, supersedes); Meta attributes (edition, product, colloquialVersion …).

  Tag data is used to identify installed software exactly and avoid heuristic normalisation; CBOR-encoded CoSWID is accepted for supply-chain tags. [ISO/IEC 19770-2:2015; IETF RFC 9393]
- **Entitlement records (ENT)** — Import/export of entitlements in the 19770-3 schema: licensor, licensee, product identification linked to SWID identifiers, rights, limitations, metrics, term, and purchase references. Upgrade and maintenance entitlements link to base licences. (Element-level names unverified.) [ISO/IEC 19770-3:2016]
- **Resource utilisation measurement (RUM)** — Consumption records per product, metric, instance and period, ingested from vendor tools and cloud platforms and used for usage-based licences and SaaS. [ISO/IEC 19770-4:2017]
- **Inventory controls for security** — Asset owners, acceptable-use acknowledgement records, return of assets at termination (with a leaver checklist), removable-media register, off-premises equipment register, and equipment maintenance records. [ISO/IEC 27001 A.5.9–5.11, A.7.9, A.7.10, A.7.13]
- **Strategic asset management (ISO 55001:2024)** — Asset management policy, **strategic asset management plan (SAMP)**, asset management plans per asset class, and documented decision-making criteria (lifecycle cost, risk, performance, sustainability). The 2024 edition adds asset data/information requirements and knowledge, plus risk-based planning, management of change and outsourced-activity control. [ISO 55000:2024/55001:2024; ISO 55013 (data)]
- **Cloud and SaaS assets** — Cloud resources and SaaS subscriptions as assets, with cost and usage ingested in FinOps FOCUS format. SaaS discovery (SSO logs, expense data) for shadow IT; rightsizing and unused-subscription reclamation. [FinOps FOCUS; COBIT BAI09.04]
- **Contracts, warranties, leases** — Contract records linked to assets and entitlements, with warranty and lease expiry alerts, maintenance coverage and residual value. [ISO/IEC 20000-1 §8.2.5 "assets used to deliver services shall be managed"]
- **Sustainability attributes** — Energy draw, embodied carbon, refurbishment/reuse status and e-waste disposal route per asset. Feeds sustainability objectives and reporting. [ISO/IEC TS 20000-16:2025; ISO/IEC TS 19770-13 (publication status unverified); climate-action amendments 2024]
- **Vendor-audit readiness** — An audit-defence pack per publisher: ELP history, entitlement proofs, deployment evidence with discovery timestamps, and communications log. [ISO/IEC 19770-1 trustworthy data]
- **ITAM reports** — Compliance position by publisher, spend and savings, shelfware, utilisation, discovery coverage (managed vs unmanaged devices), age and refresh forecast, warranty expiries, disposal certificates, and assets without owners. [COBIT BAI09; ISO/IEC 19770-1 §9]
- **AI assistance** — Software normalisation (raw install strings to publisher/product/version/edition) [AI]; entitlement extraction from contracts and invoices (OCR + LLM) with human verification [AI]; reclaim and rightsizing recommendations [AI]; hardware failure and refresh prediction from telemetry [AI]; anomaly detection in SaaS usage and spend [AI].

### Implementation notes
- **Asset vs CI.** An asset is the financial and contractual view (cost, contract, depreciation, owner); a CI is the operational view (relationships, status). Link them 1:1 for hardware; many software installs (CIs) consume one entitlement (asset).
- **Licence engine.** Store **product-use rights** as versioned rules per (publisher, product, licence model, agreement). The calculation runs as a pipeline: normalise installs → match to product → apply rights (downgrade, virtualisation) → allocate entitlements (most specific first) → compute shortfall or surplus → snapshot. Every snapshot keeps the rule versions used.
- **Catalogue keys.** Keep a canonical software catalogue keyed by (publisher, product, version, edition) with SWID tagId/regid, CPE and purl aliases. Vulnerability matching (security) and licence matching (ITAM) share it.
- **Disposal evidence** is mandatory before a status can move to Disposed: wipe method (e.g., NIST SP 800-88 purge/destroy), certificate ID and vendor.

## Module: slm

### Features
- **Agreement hierarchy** — Four agreement types:
  - **SLA** with customers: services, service level targets, **workload limits** and **exceptions**.
  - **OLA**/documented agreements with internal suppliers and customers acting as suppliers.
  - **Underpinning contracts** with external suppliers.
  - **Collaboration agreements** among providers in SIAM (non-contractual; how providers work together).

  Each agreement has an owner (FitSM "SLA/OLA/UA owner" case role), version, validity, review date, linked services and CIs, and targets. [ISO/IEC 20000-1 §8.3.3, §8.3.4; FitSM-1 v3.0 PR2.1–2.5; COBIT APO09.03; SIAM BoK]
- **Service level targets** — A target definition holds: metric (availability %, response/resolution time, fulfilment time, throughput, error rate, experience score), measurement window, business calendar, exclusions (planned maintenance, customer-caused, force majeure), pause conditions, threshold levels (warning/breach) and service credit or penalty rules. Targets can apply per priority, per catalogue item or per CI tier. [ISO/IEC 20000-1 §8.3.3; COBIT APO09.03]
- **SLA clocks** — Per-record timers with start, pause and stop conditions; business-hour calendars; breach prediction; escalations at % elapsed; retroactive recalculation flagged. Durations are kept separately per provider (time with each SIAM provider) and per agreement (end-to-end SLA vs provider OLA). [ISO/IEC 20000-1 §8.3.3; SIAM BoK]
- **Monitoring, reporting and review at planned intervals** — Performance against targets is monitored, reviewed and reported. Service reviews with customers at planned intervals produce minutes, actions and agreement changes. Agreements and contracts are reviewed periodically. [ISO/IEC 20000-1 §8.3.3; FitSM PR2.2, PR2.4, PR7.4; COBIT APO09.04–09.05]
- **SLOs, SLIs and error budgets** — Service level objectives defined on service level indicators:
  - SLI = good events ÷ valid events, e.g. requests < 300 ms ÷ all requests; availability = successful ÷ total.
  - SLO = a target over a rolling (e.g., 28/30-day) or calendar window.
  - **Error budget** = 1 − SLO.
  - **Error-budget policy**: what happens when the budget is exhausted (feature freeze, reliability work), exemptions and escalation path.
  - **Burn-rate alerting**: multi-window, multi-burn-rate. Page at 14.4× over 1 h (5 min short window), i.e. 2% of a 30-day budget; page at 6× over 6 h (30 min), i.e. 5%; ticket at 1× over 3 days (6 h), i.e. 10%.

  SLOs are internal reliability targets; SLAs are external promises with consequences. [Google SRE Workbook "Alerting on SLOs", "Implementing SLOs", error-budget policy]
- **OpenSLO import/export** — SLO definitions as code with the kinds `Service`, `SLO`, `SLI`, `DataSource`, `AlertPolicy`, `AlertCondition`, `AlertNotificationTarget` (apiVersion `openslo/v1`), so SLOs can live in Git with the services. [OpenSLO v1]
- **Experience Level Agreements (XLA)** — Experience targets per service, team or touchpoint. Main measures:
  - **Happiness** score from −100 to +100: % of 9–10 ratings minus % of 0–6 ratings, on a 0–10 scale.
  - **Perceived lost time** per ticket or area.
  - **Experience factors**: what influenced the rating.

  Measurements cover ticket-based touchpoints (incidents, requests) and proactive areas (overall IT experience, enterprise applications, laptops and computers, mobile devices, remote work, office environment, service portal, collaboration with IT). XLA targets can be added to contracts as reporting-only, target, bonus/malus or gain-share clauses (HappySignals' four contracting options). ISO/IEC TS 20000-18:2026 now gives guidance on experience management within an ISO/IEC 20000-1 SMS. [HappySignals; ISO/IEC TS 20000-18:2026]
- **Watermelon detection** — Flags services that are green on SLA but red on experience or business outcome, e.g. SLA met with Happiness below threshold, or rising perceived lost time. [XLA practice; SIAM BoK end-to-end measurement]
- **End-to-end vs provider measures (SIAM)** — End-to-end service targets measured by the integrator. Provider OLAs/contract targets measured per provider segment, with attribution rules (who owned the ticket when the breach happened). Shared targets across providers are backed by collaboration agreements, and integrator-level balanced scorecards. [SIAM BoK; ISO/IEC TS 20000-14:2023]
- **Service credits and penalties** — Credit calculation rules per breach tier and the contract's caps. Disputed measurements go through a dispute workflow (raise → evidence → decision), and credits are passed to supplier invoicing. [ISO/IEC 20000-1 §8.3.4.1 contract disputes; COBIT APO10.05]
- **Workload limits and exceptions** — Agreed volume ceilings (e.g., 500 requests/month) and exception clauses are stored with the SLA. Breaches beyond workload limits are excluded or reported separately. [ISO/IEC 20000-1 §8.3.3 "service level targets, workload limits and exceptions"]
- **Customer satisfaction and complaints** — Satisfaction measured at planned intervals. Complaints are recorded, investigated, acted upon, reported and formally closed, with escalation if not resolved through normal channels. [ISO/IEC 20000-1 §8.3.2; FitSM PR7.5–7.6; ISO 10002]
- **Service reporting** — A report register: identity, purpose, audience, frequency, content, format and method of delivery. Each report has an owner and an agreed recipient list, and delivery evidence is logged. Reports must cover performance against targets, significant events and detected nonconformities, include trends, and lead to decisions/actions communicated to interested parties. [FitSM-1 v3.0 PR3.1–3.3; FitSM-3 "report owner"; ISO/IEC 20000-1 §9.4]
- **AI assistance** — Breach prediction per open record (time-to-breach given queue, skills, schedule) [AI]; narrative SLA/XLA report drafting with drivers of change [AI]; identification of experience drivers from free-text survey comments (topic clustering) [AI].

### Implementation notes
- **Target definitions** are versioned and effective-dated. Each record stores the definition version applied, so a later contract change does not rewrite history.
- **Clock engine.** Implement as an event-sourced state machine per (record, target): `start`, `pause(reason)`, `resume`, `stop`, `reset`. Elapsed business time = sum of active intervals ∩ calendar. Recompute on calendar change only for open clocks, and log recomputations.
- **SLIs from telemetry.** Compute them as ratios of good to valid events, aggregated in fixed buckets (e.g., 1 min) so multi-window burn rates are cheap: `burn_rate(w) = (1 − SLI_w) / (1 − SLO)`.
- **XLA.** Store raw responses (score 0–10, lost-time bucket, factors, comment). Happiness = (`count(9–10)` − `count(0–6)`) ÷ `count(all)` × 100. Report the sample size beside the score, and suppress scores for groups smaller than the anonymity threshold.

## Module: service_portfolio

### Features
- **Service portfolio and catalogue** — Every service is specified in the portfolio. Pipeline (proposed), live (catalogue) and retired services carry lifecycle state, owner, customers, supporting services, suppliers (internal/external, federation members) and contact points. One or more catalogues describe services, intended outcomes and dependencies for customers, users and other interested parties. [ISO/IEC 20000-1 §8.2.4; FitSM-1 v3.0 PR1.1, PR1.4, PR2.1; COBIT APO09.01–09.02, BAI03.11]
- **Service record** — Fields: service ID, name, description, intended outcomes/value, service owner (FitSM case owner), customers and user groups, service type (business/customer-facing, technical/supporting, enabling), lifecycle state, service hours, support channels, SLA templates, supporting services and CIs (services are CIs), suppliers, cost model and price, risks, continuity tier, security classification, documentation links, and dependencies.
- **Service lifecycle** — Proposed → Approved (chartered) → In design → In transition → Live/Operational → Deprecated (closed to new subscribers) → Retired. Major changes (new service, removal, transfer to another party) go through service design and transition, and the change-management policy defines which changes count as major. [ISO/IEC 20000-1 §8.5.1.1, §8.5.2; FitSM PR1.3]
- **Service proposals / demand intake** — Proposals for new or changed services are evaluated on predicted demand, required resources and expected benefits. Prioritisation is aligned with business needs and SM objectives, with potential impact on the SMS, existing services, constraints and dependencies considered. [FitSM-1 v3.0 PR1.2; ISO/IEC 20000-1 §8.2.2]
- **Investment portfolio governance** — Funding sources, program selection, benefits tracking and portfolio performance reporting. [COBIT APO05.01–05.05; EDM02 benefits delivery]
- **Control of parties in the lifecycle** — For services or components provided by other parties (internal or external suppliers, customers acting as suppliers): selection/evaluation criteria and controls are recorded per party. The organisation retains accountability. [ISO/IEC 20000-1 §8.2.3]
- **Product view (IT4IT / VeriSM)** — Digital products as the portfolio unit: product backlog, product releases and service offers. The Evaluate value stream (portfolio assessment and rationalisation) and the Explore value stream (feature direction and backlog) are supported. VeriSM's Define stage (consumer needs → requirements → solution design → **service blueprint**) can be modelled as a product/service design record. [IT4IT 3.0; VeriSM]
- **Service Model Canvas** — A one-page structured description of a service (customer, value proposition, facilities and support, agreements, delivery teams) used to design and agree services. (Canvas field names unverified.) [USM]
- **Business relationship management** — Customers, users and interested parties identified and documented, with a designated relationship manager per customer (FitSM "customer relationship manager (account manager)" case role). Communication channels cover ordering, escalation and complaints. Business expectations and opportunities are captured, and performance trends reviewed with customers at planned intervals. [ISO/IEC 20000-1 §8.3.2; FitSM PR7.1–7.4; COBIT APO08.01–08.05]
- **Demand management** — Current and forecast demand per service is determined and analysed at planned intervals. Demand and consumption are monitored and reported; consumption comes from subscriptions, usage records and ticket volumes. [ISO/IEC 20000-1 §8.4.2]
- **Rationalisation analytics** — Cost per service, utilisation, satisfaction (XLA), risk, technical health and strategic fit as portfolio scorecards. Candidates for retirement or consolidation can be exported to TBM views. [TBM Taxonomy; IT4IT Evaluate]
- **Service design & transition package** — For each major change: plans, design outputs and acceptance results (FitSM-4 provides a "Service design and transition package" template). [FitSM-4; ISO/IEC 20000-1 §8.5.2]
- **AI assistance** — Duplicate/overlapping service detection from descriptions and usage [AI]; drafting of catalogue descriptions in plain language, checked for readability and accessibility [AI]; demand forecasting per service from ticket and usage history [AI].

### Implementation notes
- **Three catalogue views.** A service portfolio (all lifecycle states, internal) is distinct from customer-facing **service catalogue(s)**, which are filtered views per audience, and from the **request catalogue** (orderable offers). Keep one service table with views, not three copies.
- **Services are CIs.** Model `service` as a CI class with extra portfolio attributes, so dependency mapping and impact analysis reuse the CMDB graph.
- **Offers** (IT4IT Service Offer) are separate from services: one service can have several offers (sizes, regions, price points), each with entitlement rules and an SLA template.

## Module: event

### Features
- **Monitoring of I&T infrastructure** — Events from infrastructure, applications and services are captured and filtered; meaningful events are classified (informational, warning, exception) and correlated. Alerts become incidents, and alerts and actions are logged. [COBIT DSS01.03; MOF 4.0 Service Monitoring and Control SMF; IT4IT D2C Event and Service Monitoring components]
- **Availability and capacity monitoring** — Availability of services and components monitored against targets, and capacity utilisation monitored with warning and exception thresholds. [FitSM-1 v3.0 PR4.4, PR5.4; ISO/IEC 20000-1 §8.4.3, §8.7.1; COBIT BAI04.04]
- **Logging control** — Logs that record activities, exceptions, faults and other relevant events are produced, stored, protected and analysed. The tool provides:
  - Log-source inventory and required content (user IDs, system activities, timestamps, event details, device identity, network addresses, protocols).
  - Retention per source, tamper protection and privileged-operation logging.
  - Review evidence, plus clock synchronisation status per source.

  [ISO/IEC 27001 A.8.15, A.8.17; NIST CSF DE.CM, PR.PS-04]
- **Monitoring for anomalous behaviour** — Networks, systems and applications are monitored for anomalous behaviour against baselines. Detected anomalies are evaluated and can raise security incidents. [ISO/IEC 27001 A.8.16; NIST CSF DE.CM-01/-02/-03/-06/-09; DE.AE-02 (adverse events analysed), DE.AE-03 (correlated from multiple sources), DE.AE-04 (impact and scope estimated), DE.AE-06 (information provided to authorised staff and tools), DE.AE-07 (threat intelligence integrated), DE.AE-08 (incidents declared when events meet defined criteria)]
- **Detection mechanisms (EU DORA)** — Mechanisms to promptly detect anomalous activities, with multiple layers of control, defined alert thresholds and criteria to trigger incident detection and response, and dedicated resources for monitoring user activity and anomalies. [EU DORA Art. 10]
- **Symptom-based, SLO-driven alerting** — The four golden signals (latency, traffic, errors, saturation). Pages fire only on actionable, user-visible symptoms that threaten SLOs, using burn-rate alerting; everything else becomes a ticket or dashboard. The target is about one incident per alert, and noisy alerts are tracked for removal. [Google SRE book "Monitoring Distributed Systems", "Being On-Call"; SRE Workbook]
- **On-call management** — Rotations with primary and secondary, follow-the-sun schedules, escalation policies, acknowledgement deadlines (e.g., 5 min for user-facing services, 30 min for less time-critical ones), overrides and swaps, and compensation tracking (time-off-in-lieu or pay, capped). Load guardrails are measured per shift: SRE guidance is at most about 2 incidents per 12-hour shift (≈6 h of work per incident), a median of zero pages per day, at most 25% of engineer time on call and at most 50% on operational work. Minimum rotation sizes are 8 engineers for a single site or 6 per site for dual-site. [Google SRE book ch. 11]
- **Operational overload controls** — Quarterly page/ticket goals, alert-quality reviews, the "give back the pager" policy, and Wheel-of-Misfortune and disaster-recovery training drills (DiRT) scheduled for skill retention. [Google SRE book ch. 11]
- **Runbooks and automated remediation** — Diagnostic and remediation runbooks linked to alert types and CIs. Automated actions run under change policy (pre-approved standard changes), with every action logged. [IT4IT Diagnostics & Remediation; COBIT DSS01.01 operational procedures; ISO/IEC 27001 A.5.37 documented operating procedures]
- **Operational schedule** — Batch jobs, backups and maintenance windows as scheduled operations with success/failure monitoring. Failed backups raise incidents. [COBIT DSS01.01, DSS04.07; ISO/IEC 27001 A.8.13]
- **Environment and facilities monitoring** — Power, cooling, fire, water and physical-access sensor events. [COBIT DSS01.04–01.05; ISO/IEC 27001 A.7.5, A.7.11]
- **Telemetry standards** — Ingest OpenTelemetry (traces, metrics, logs with semantic conventions) and CloudEvents envelopes. Link events to CIs via resource attributes. [OpenTelemetry; CloudEvents (CNCF)]
- **Event reporting** — Alert volumes by source, noise ratio (alerts without action), mean time to acknowledge, pages per shift, on-call load per person, auto-remediation success, and monitoring coverage of critical CIs. [SRE; COBIT DSS01]
- **AI/AIOps** — Event deduplication and correlation into situations using topology, time and text similarity [AI]; anomaly detection on metrics (seasonal baselines) [AI]; probable-cause CI ranking [AI]; alert-noise suggestions, i.e. which alerts never lead to action [AI]; predictive capacity alerts [AI].

### Implementation notes
- **Pipeline:** ingest → normalise (OpenTelemetry/CloudEvents) → enrich (CI lookup, maintenance-window suppression, change-in-progress tag) → deduplicate (fingerprint = source + check + CI) → correlate (time window + topology neighbourhood) → decide (rule: create incident, update, or auto-remediate). Persist each decision with the rule version, for audit and noise analysis.
- **Maintenance suppression** must use the approved change's window and CIs. Alerts during a change go to the change record rather than being dropped.
- **On-call load metrics** are computed per person per shift from page acknowledgements and incident durations, and feed workforce fairness reporting.

## Module: continuity

### Features
- **Business continuity management system** — The MS kernel scoped for BCMS: BC policy, objectives, roles, competence, documented information, internal audit, management review. Since Amd 1:2024 it also records the climate-change consideration. [ISO 22301:2019 + Amd 1:2024; ISO 22313]
- **Business impact analysis (BIA)** — Per product/service, activity and process:
  - Impact categories over time (financial, regulatory, reputational, customer, safety), with impact ratings per time bucket (e.g., 4 h, 1 d, 3 d, 1 w).
  - **MTPD** (maximum tolerable period of disruption), **RTO** (≤ MTPD), **RPO** and **MBCO** (minimum business continuity objective).
  - Dependencies on people, sites, ICT systems/CIs, suppliers and information.
  - Prioritised activities and resource requirements over time.

  BIA results are approved and reviewed at planned intervals. [ISO 22301 §8.2.2; ISO/TS 22317; ISO/IEC 27031:2025]
- **Continuity risk assessment** — Risks of disruption are identified, analysed and evaluated with treatment decisions, using the same risk engine as security risk (ISO 31000 scales). [ISO 22301 §8.2.3; ISO/IEC 20000-1 §8.7.2 "at planned intervals, risks to service continuity shall be assessed and documented"; FitSM PR4.2]
- **BC strategies and solutions** — Options per prioritised activity (alternate site, work-from-home, manual workaround, supplier diversification, ICT redundancy/DR), with cost, capability and RTO fit, selection rationale and resource requirements. [ISO 22301 §8.3]
- **Plans and procedures** — An incident response structure (teams, roles, authorities), warning and communication procedures, BC plans and recovery plans. ISO/IEC 20000-1 requires service continuity plans to include:
  - criteria and responsibilities for invoking continuity;
  - procedures for a major loss of service;
  - availability targets while the plan is invoked;
  - service recovery requirements;
  - procedures for returning to normal working conditions.

  Plans and contact lists must be **accessible when normal locations are unavailable**, so the tool offers offline/mobile copies and export. [ISO 22301 §8.4; ISO/IEC 20000-1 §8.7.2]
- **Exercise and test programme** — Tabletop, walkthrough, simulation, component/DR failover and full exercises. Each has scenario, objectives, participants, results against RTO/RPO, issues, a post-exercise report and actions. Tests run at planned intervals and after significant changes, and reviews take place after each test and after each real invocation. [ISO 22301 §8.5; ISO/IEC 20000-1 §8.7.2; COBIT DSS04.04; EU DORA Art. 11(6), Art. 24–25]
- **Invocation and crisis management** — Invocation record (who, when, criteria met), crisis team roster, decision log, communications log, recovery progress against RTO and stand-down. Post-resumption review follows. [ISO 22301 §8.4; COBIT DSS04.03, DSS04.08; NIST CSF RC.RP-01..06, RC.CO-03/04]
- **ICT readiness for business continuity (IRBC)** — ICT services mapped to BIA requirements (RTO/RPO/MBCO), with ICT continuity strategies (redundancy, backup, DR site, cloud dependencies), ICT DR plans and ICT continuity tests. [ISO/IEC 27031:2025 (2nd edition, May 2025); ISO/IEC 27001 A.5.30]
- **Information security during disruption** — Security controls kept at the planned level during disruption, with temporary controls documented. [ISO/IEC 27001 A.5.29]
- **Backup and redundancy** — A backup policy per system (frequency, retention, copies, segregation, encryption), backup job monitoring, restore tests with evidence, and redundancy design for availability requirements. [ISO/IEC 27001 A.8.13–8.14; COBIT DSS04.07; EU DORA Art. 12 backup policies, restoration and recovery]
- **EU DORA ICT continuity** — ICT business continuity policy, ICT response and recovery plans, BIA, crisis communication plans, yearly testing of plans for critical ICT systems, and a record of activities before and during disruption. Testing covers the digital operational resilience testing programme (Art. 24–25, risk-based tests) and threat-led penetration testing (TLPT, Art. 26) for designated entities, generally every three years. [EU DORA Art. 11–12, 24–27]
- **Service availability management** — Availability requirements and targets per service, availability risks assessed at planned intervals, measurement against targets, and **investigation of unplanned non-availability** with actions. Availability plans have an owner (FitSM "availability plan owner"). [ISO/IEC 20000-1 §8.7.1; FitSM PR4.1–4.4]
- **Capacity management** — Capacity requirements cover human, technical, information and financial resources. A capacity plan holds:
  - current and forecast capacity based on demand;
  - the expected impact of availability, continuity and service-level requirements;
  - timescales, thresholds and upgrade costs.

  Utilisation is monitored and performance data analysed for improvements. Capacity plans have an owner. [ISO/IEC 20000-1 §8.4.3; FitSM-1 v3.0 PR5.1–5.4; COBIT BAI04.01–04.05; ISO/IEC 27001 A.8.6]
- **Overload and reliability engineering** — Load testing, capacity forecasting with headroom (N+2 for critical services), load shedding/graceful degradation policies, and disaster-recovery testing (DiRT). [Google SRE book: "Handling Overload", "Addressing Cascading Failures"]
- **Reports and evidence** — BIA coverage (% services with a current BIA), plan currency (last review), exercise completion against plan, RTO/RPO achievement in tests, open remediation actions, backup success and restore-test pass rate, and availability vs target with unplanned-outage root causes. [ISO 22301 §9; COBIT DSS04; MEA01]
- **AI assistance** — Draft BIA from CMDB dependencies and incident history (human-approved) [AI]; scenario generation for tabletop exercises [AI]; plan-gap analysis against ISO 22301/EU DORA checklists [AI]; capacity forecasting [AI].

### Implementation notes
- **Dependency inheritance.** RTO/RPO requirements flow from business activities (BIA) down the CMDB graph to supporting CIs. A CI's required RTO = min(RTO of all dependent activities). Flag CIs whose tested recovery time exceeds the required RTO.
- **Validation rules:** RTO ≤ MTPD; RPO ≤ the backup interval of the supporting data stores; exercise objectives reference specific RTO/RPO targets.
- **Offline availability.** Export plans with contacts to encrypted offline bundles (mobile app cache, PDF with watermark/version). Record the version distributed to each plan holder so stale copies can be recalled.

## Module: security

### Features
- **ISMS on the MS kernel** — ISMS scope, information security policy and topic-specific policies, objectives, roles, risk methodology, risk assessment and treatment, **Statement of Applicability (SoA)**, internal audit, management review, nonconformities. The SoA lists all 93 Annex A controls with: applicable (yes/no), justification for inclusion or exclusion, implementation status, owner, and links to implementing procedures and evidence. [ISO/IEC 27001:2022 + Amd 1:2024 §4–10, §6.1.3(d)]
- **Control attributes for tagging and filtering** — Each 27002 control carries five attributes:
  - control type: preventive, detective, corrective;
  - information security properties: confidentiality, integrity, availability;
  - cybersecurity concepts: identify, protect, detect, respond, recover;
  - operational capabilities, e.g. asset management, identity and access management, threat and vulnerability management, continuity, supplier relationships security, information security event management;
  - security domains: governance & ecosystem, protection, defence, resilience.

  The control library stores these so dashboards can pivot by them. [ISO/IEC 27002:2022 §4.2]
- **Risk register and treatment** — Risk record fields:
  - What: risk ID, title, scenario (asset/service, threat source, event, consequence), category (security, availability, continuity, supplier, AI, privacy, project).
  - Ownership and analysis: risk owner, inherent likelihood and impact (scale per ISO 31000 criteria), existing controls.
  - Treatment: residual rating, option (modify/reduce, retain/accept, avoid, share/transfer), treatment plan with tasks and due dates, target rating.
  - Approval and monitoring: risk acceptance by the risk owner (name, date, expiry), KRIs, review date, linked incidents, problems, vulnerabilities, audit findings and changes.

  The ISO 31000 process steps (communication & consultation; scope, context & criteria; assessment = identification, analysis, evaluation; treatment; monitoring & review; recording & reporting) map to workflow states. [ISO 31000:2018 (revision at CD stage); ISO/IEC 27005:2022; COBIT APO12.01–12.06; FitSM-1 v3.0 PR4.2, PR6.2; FitSM-3 "security risk owner"]
- **Risk appetite and aggregation** — Appetite and tolerance statements per category, with roll-up of risks to services, business units and enterprise risk profile (heat maps, trend). Treatment portfolio tracking. [COBIT APO12.03–12.05; NIST CSF GV.RM-01..07]
- **NIST CSF 2.0 profiles** — Current and target **Organizational Profiles** over the 6 functions, 22 categories and 106 subcategories (GV.OC, GV.RM, GV.RR, GV.PO, GV.OV, GV.SC; ID.AM, ID.RA, ID.IM; PR.AA, PR.AT, PR.DS, PR.PS, PR.IR; DE.CM, DE.AE; RS.MA, RS.AN, RS.CO, RS.MI; RC.RP, RC.CO). Also: implementation tiers (Partial, Risk Informed, Repeatable, Adaptive), gap analysis and action plan, and import of **Community Profiles** (e.g., SP 800-61r3 is a CSF 2.0 community profile). [NIST CSF 2.0]
- **Vulnerability management** — Sources: scanner findings, SBOM-based matches, vendor advisories (CSAF 2.0), and coordinated-disclosure reports received (ID.RA-08). Each finding links to the asset/CI and its criticality. Prioritisation uses:
  - **CVSS 4.0** (base, threat, environmental, supplemental metric groups);
  - **EPSS** probability of exploitation;
  - **CISA KEV** membership (known exploited, with due dates);
  - **SSVC** decision outcomes (Track, Track*, Attend, Act);
  - exposure (internet-facing) and **VEX** status (not_affected, affected, fixed, under_investigation).

  Remediation runs via change/patch with SLA by priority, then verification re-scan. Exceptions need compensating controls, risk acceptance and an expiry date. [ISO/IEC 27001 A.8.8; COBIT DSS05.07; NIST CSF ID.RA-01, ID.RA-08, PR.PS-02; FIRST CVSS 4.0/EPSS; CISA KEV/SSVC]
- **Product security (manufacturers, EU CRA)** — For organisations shipping software or connected products:
  - vulnerability handling per CRA Annex I part II: SBOM, coordinated vulnerability disclosure policy, security updates;
  - **actively exploited vulnerability** and **severe incident** reporting via ENISA's **Single Reporting Platform** from **11 Sep 2026**: early warning within 24 h of awareness, notification within 72 h, final report within 14 days of a fix being available for vulnerabilities or 1 month for incidents (final-report periods per Art. 14 text, verify).

  Reporting duties cover products already on the market; most other CRA obligations apply from 11 Dec 2027. [Regulation (EU) 2024/2847 Art. 14]
- **EU DORA ICT risk-management framework** — Management-body accountability and approval (Art. 5). An ICT risk-management framework reviewed at least yearly and after major incidents (Art. 6). Identification (Art. 8), protection and prevention (Art. 9), detection (Art. 10), response and recovery (Art. 11), backup (Art. 12), learning and evolving (Art. 13), communication (Art. 14), plus a simplified framework for small entities (Art. 16). Detailed requirements are in the RTS on ICT risk management (Del. Reg. 2024/1774). [EU DORA]
- **NIS2 measures** — The Art. 21(2) measures as a control set:
  - (a) risk analysis and information-system security policies;
  - (b) incident handling;
  - (c) business continuity, backup, disaster recovery and crisis management;
  - (d) supply-chain security;
  - (e) security in acquisition, development and maintenance, including vulnerability handling and disclosure;
  - (f) effectiveness-assessment policies;
  - (g) cyber hygiene and training;
  - (h) cryptography;
  - (i) HR security, access control and asset management;
  - (j) MFA, secured communications and emergency communications.

  Art. 20 requires management-body approval, oversight and training, which the tool records. [Directive (EU) 2022/2555; Impl. Reg. 2024/2690]
- **Policy management and attestation** — Policy library (versioned, approved), attestation campaigns (users acknowledge policies), exception/waiver requests with risk acceptance and expiry, and awareness training completion records. [ISO/IEC 27001 A.5.1, A.6.3; NIS2 Art. 20(2)]
- **Audit management** — Audit universe, risk-based audit plan, engagements (scope, criteria, auditors with independence checks), work programmes, workpapers and evidence requests, findings (nonconformity major/minor, observation, opportunity), management action plans and follow-up to closure. ISO/IEC 20000-1 §9.2 requires an internal audit programme with frequency, methods, responsibilities, planning requirements and reporting, and auditor objectivity. [ISO 19011; COBIT MEA04.01–04.09; ISO/IEC 20000-1 §9.2]
- **Controls assurance** — Control self-assessments, design and operating effectiveness tests, and **continuous control monitoring** (automated tests over ITSM data, e.g. "% production changes with approved CR", "% leavers with access removed within 24 h", "% critical vulnerabilities fixed within SLA"). Deficiencies are reported and tracked. [COBIT MEA02.01–02.04; SOC 2 CC4; SOX ITGC]
- **Compliance obligations register** — Legal, statutory, regulatory and contractual requirements with owner, applicability, mapped controls, and confirmation and assurance status. [ISO/IEC 27001 A.5.31; COBIT MEA03.01–03.04]
- **Information protection controls** — Classification and labelling (A.5.12–5.13), information transfer (A.5.14), privileged access with break-glass records (A.8.2), information deletion (A.8.10), data masking (A.8.11), DLP events (A.8.12), and threat intelligence intake (A.5.7, e.g. STIX/TAXII). [ISO/IEC 27001:2022]
- **External assurance frameworks** — Evidence sets for SOC 2 Trust Services Criteria (CC1–CC9 plus Availability, Confidentiality, Processing Integrity, Privacy), PCI DSS v4.0.1 (12 requirements; e.g. 6.5.1 change control, 10 logging, 12.10 incident response), SOX IT general controls (access, change, operations) and NIST SP 800-53 Rev. 5 via OSCAL catalogs. [AICPA TSC; PCI SSC; NIST OSCAL 1.1.x]
- **Privacy management system** — PIMS controls for PII controllers and processors, now a standalone management system standard. [ISO/IEC 27701:2025]
- **Security reporting** — Risk heat map and trend, SoA implementation status, control effectiveness, CSF current-vs-target gaps, vulnerability SLA compliance and mean time to remediate by severity, exception ageing, audit-finding ageing, policy attestation rates, and regulatory reporting timeliness. [COBIT MEA01; ISO/IEC 27001 §9.1]
- **AI assistance** — Cross-framework control mapping suggestions [AI]; evidence sufficiency checks (does this artefact satisfy the control test?) [AI]; vulnerability prioritisation combining EPSS, KEV, exposure and CI criticality [AI]; security-questionnaire auto-answering from the control library with citations [AI]; risk-scenario drafting from incidents and threat intelligence [AI]; access-log anomaly detection [AI].

### Implementation notes
- **One risk engine** serves security, continuity, supplier, AI, privacy and project risk, with a shared scale definition (versioned) and per-category fields. Risks link to controls (mitigates), assets/services (affects), and incidents (materialised).
- **Control tests** are scheduled jobs (planned-interval engine). Each run stores population size, sample, exceptions, conclusion, tester and evidence hash.
- **Vulnerability SLA clocks** start at first detection on the asset, not at ticket creation. VEX "not_affected" must carry a justification code and an approver.
- **SoA generation** comes from the control library; inclusion/exclusion changes are audited and need ISMS-owner approval.

## Module: supplier

### Features
- **Supplier register** — Every internal and external supplier is identified, each with a designated relationship manager (FitSM "supplier relationship manager" case role) and communication and escalation channels. Fields include: legal entity and identifiers (LEI/EUID for EU DORA), category (strategic, tactical, commodity), services supplied, supported services and CIs, criticality, **supports critical or important functions (EU DORA)**, data processed (personal data? special categories? locations), certifications (ISO/IEC 27001 certificate expiry, SOC 2 report period and bridge letters), sub-contractors (fourth parties), concentration and substitutability assessments, risk tier and status. [ISO/IEC 20000-1 §8.3.4.1; FitSM-1 v3.0 PR8.1–8.3; COBIT APO10.01]
- **Contracts and agreements** — Contract record fields:
  - Parties, type, start/end, renewal and notice dates, value.
  - Services and dependencies between services/components and suppliers.
  - Requirements, service level targets and contractual obligations, authorities and responsibilities.
  - Data locations, security requirements, audit and access rights, subcontracting terms, termination and exit clauses.

  Internal suppliers and customers acting as suppliers get documented agreements with targets. [ISO/IEC 20000-1 §8.3.4.1–8.3.4.2; ISO/IEC 27001 A.5.20]
- **Selection and due diligence** — Pre-contract assessment: risk, information-security and privacy questionnaires (e.g., SIG, CSA CAIQ), financial stability, conflicts of interest, critical-function determination and approval. [COBIT APO10.02; NIST CSF GV.SC-06; EU DORA Art. 28(4)]
- **Performance monitoring at planned intervals** — Scorecards with SLA attainment, incidents caused, problem actions overdue, invoice accuracy, relationship quality and XLA (for SIAM). Supplier reviews with minutes and actions; contracts reviewed at planned intervals. **Contract disputes** are recorded, managed and formally closed. [ISO/IEC 20000-1 §8.3.4.1; FitSM PR8.4; COBIT APO10.05; ISO/IEC 27001 A.5.22]
- **Supplier risk management** — Supplier risk assessments (security, privacy, continuity, concentration, geopolitical), continuous monitoring of supplier risk signals, and risk treatment linked to the shared risk engine. [COBIT APO10.04; ISO/IEC 27001 A.5.19, A.5.21; ISO/IEC 27036 series; NIST CSF GV.SC-01..10]
- **NIST CSF supply-chain controls** —
  - GV.SC-04: suppliers known and prioritised by criticality.
  - GV.SC-05: requirements in contracts.
  - GV.SC-06: due diligence.
  - GV.SC-07: risks understood, recorded, prioritised, assessed, responded to and monitored over the relationship.
  - GV.SC-08: suppliers included in incident planning, response and recovery.
  - GV.SC-09: supply-chain practices integrated and monitored.
  - GV.SC-10: provisions for activities after the relationship ends.

  [NIST CSF 2.0 GV.SC]
- **EU DORA register of information** — Maintain the register of all contractual arrangements for ICT services. It is structured per the ITS on the register of information (**Impl. Reg. (EU) 2024/2956: 15 linked templates, RT.01.01 onward**): entity, contractual arrangements, ICT services, functions (critical or important), providers and sub-contracting chain, substitutability and exit. It is submitted annually to the competent authority as **xBRL-CSV** (Excel not accepted; e.g., DNB deadline 20 Mar 2026). Validation rules check identifiers (LEI/EUID), dates and linkages. [EU DORA Art. 28(3); ITS 2024/2956]
- **EU DORA contract provisions and exit** — Contract checklist per Art. 30: function and service descriptions, data locations, data protection, access/recovery/return of data, service levels, incident assistance, cooperation with authorities, termination rights, awareness/training participation. For **critical or important functions** it adds: precise quantitative and qualitative service levels, notice and reporting obligations, business contingency plans and testing, TLPT participation, unrestricted access/inspection/audit rights and **exit strategies** with a mandatory transition period. Also: concentration-risk assessment (Art. 29), termination triggers (Art. 28(7)), documented and tested exit plans (Art. 28(8)). [EU DORA Art. 28–30]
- **Cloud services** — Processes for acquisition, use, management and exit of cloud services: shared-responsibility matrix, exit/portability plan, cloud provider certifications. [ISO/IEC 27001 A.5.23]
- **Processors and transfers (GDPR)** — Data-processing agreements per Art. 28, a sub-processor list with change-notification handling, links to ROPA entries (Art. 30), and transfer mechanism records (SCCs, adequacy, DPF) with transfer impact assessments. [GDPR Art. 28, 30, 44–49]
- **Multi-provider ecosystem (SIAM)** — Layers: customer organisation (retained capabilities), service integrator, service providers. Supported structures: externally sourced, internally sourced, hybrid, lead supplier. Further features:
  - provider onboarding/offboarding checklists;
  - **collaboration agreements** (non-contractual working rules between providers);
  - structural elements: **boards** (strategic, tactical, operational), **process forums** (e.g., problem, change) and **working groups**, each with membership, cadence, minutes and actions;
  - shared data dictionary and integration standards;
  - cross-provider dispute and escalation paths.

  SIAM BoK v3.0 (Nov 2025) adds compendiums on SIAM processes, AI, ISO standards, procurement, end-to-end measurement, trust and collaborative culture. [SIAM BoK; ISO/IEC TS 20000-14:2023]
- **Collaborative relationship lifecycle** — For strategic suppliers, ISO 44001's eight stages: operational awareness, knowledge, internal assessment, partner selection, working together, value creation, staying together, exit strategy activation. Each has a relationship management plan and joint governance. [ISO 44001:2017]
- **Supplier reporting** — Performance trends, renewals due (with notice deadlines), risk tiering, concentration by provider and by critical function, certification expiries, register-of-information completeness and validation errors, and dispute ageing. [COBIT APO10; EU DORA]
- **AI assistance** — Contract clause extraction with gap check against EU DORA Art. 30, GDPR Art. 28 and internal templates [AI]; questionnaire response analysis and risk summarisation [AI]; supplier risk-signal monitoring (breach news, sanctions, financial distress) [AI]; performance anomaly detection across providers [AI].

### Implementation notes
- **Register of information as projection.** Generate it from the supplier, contract, ICT service, function and CI tables rather than keeping a separate spreadsheet. Export to the ESA xBRL-CSV taxonomy and run the published validation rules before submission. Keep each submitted package immutable with its submission receipt.
- **Critical-function flags** come from the BIA and CMDB graph (continuity module). When a supplier contract supports a flagged function, Art. 30(3) clauses become mandatory checklist items.
- **SIAM data ownership.** For each integrated field, record which party is authoritative, to prevent e-bonding update loops (see incident module).

## Module: financial

### Features
- **Budgeting and accounting for services** — Budgets per service or service group under the organisation's financial-management policies. Costs are budgeted to enable financial control and decisions; actuals are monitored and reported against budget; forecasts reviewed; costs managed. [ISO/IEC 20000-1 §8.4.1; COBIT APO06.01–06.05]
- **Cost model and allocation** — General-ledger and procurement data map into **cost pools** (spend- and headcount-based labour, hardware, software, cloud, outside services, facilities, telecom), then into **technology resource towers** (TBM 5.0 adds Data, Risk & Compliance and IoT towers), then **solutions** (TBM 5.0 adds an AI solution type and retires Platform), then **consumers** (business units, products). Allocation rules (direct, usage-based, fixed %) are versioned per period. [TBM Taxonomy 5.0 (June 2025)/5.0.1; COBIT APO06.04]
- **Unit costs and showback/chargeback** — Unit costs (per ticket, per user, per device, per GB, per transaction), internal price lists per offer, and showback/chargeback statements from subscriptions and usage records (IT4IT Chargeback/Showback component). Disputes on charges are handled as requests. [IT4IT R2F; ISO/IEC 20000-1 §8.4.1]
- **Cloud cost and usage** — FOCUS-formatted ingestion of cloud, SaaS and (since 1.3/1.4) contract-commitment data. FOCUS 1.4 (ratified 4 Jun 2026) expands the Contract Commitment dataset (13 → 30 columns) and adds an Invoice Detail dataset. Supported: anomaly alerts, commitment coverage and utilisation, and tag-based allocation with untagged-spend tracking. [FinOps FOCUS 1.4; FinOps Framework]
- **Investment and benefits** — Business cases, funding approvals, benefits tracking and portfolio value reporting. [COBIT APO05, EDM02]
- **Cost of service failure** — Incident and outage cost estimates (lost revenue, productivity via perceived lost time, penalties). Feeds EU DORA "economic impact" classification and problem prioritisation. [EU DORA RTS 2024/1772; HappySignals lost time]
- **Asset financials** — Purchase cost, depreciation schedule, lease terms, residual value, capex/opex classification, and maintenance cost per asset. [ISO 55001:2024 lifecycle cost; COBIT BAI09.04]
- **Procurement link** — Requisitions and purchase orders from requests, approval by financial authority limits (delegation-of-authority matrix), and three-way match status. [COBIT APO06; segregation of duties]
- **Support economics** — Cost per contact or ticket by channel and tier (HDI benchmarks), self-service cost avoidance (self-service success × cost per assisted case), and KCS value-creation metrics. [HDI; KCS v6 T5.11–5.12, T7.3]
- **Sustainability accounting** — Energy and carbon per service and asset, and software carbon intensity for applications. [ISO/IEC TS 20000-16:2025; ISO/IEC 21031:2024 Software Carbon Intensity (verify)]
- **Financial reports** — Budget vs actual vs forecast per service and BU, unit-cost trends, allocation transparency (drill from consumer to GL), cloud spend by FOCUS dimensions, realised savings (ITAM harvest, rightsizing), and chargeback statements. [COBIT MEA01]
- **AI assistance** — Spend anomaly detection [AI]; forecasting of service costs and cloud spend [AI]; suggested allocation keys from usage correlations [AI]; invoice and contract data extraction [AI].

### Implementation notes
- Keep a **period-locked allocation run**: inputs (GL extract, usage, rules version) → outputs (allocated costs). It is reproducible and stored immutably once the period closes.
- FOCUS columns map to the internal cost model: `BilledCost`/`EffectiveCost` → actual cost, `ServiceCategory` → tower, tags → consumer/product. Unmatched rows go to an "unallocated" bucket with an owner.

## Module: project

### Features
- **Project governance objects** — Project charter/business case, sponsor, manager, plan (WBS, schedule, milestones, stage gates), RAID log (risks, assumptions, issues, decisions), project change requests (scope/time/cost), resources and assignments, budget and actuals, quality plan, stakeholder register and communication plan, status reports (RAG), lessons learned, closure report. [COBIT BAI11.01–11.09; ISO 21502:2020]
- **Methods** — Templates for predictive (PRINCE2 7: 7 principles, 7 practices, 7 processes), adaptive (Scrum, Kanban) and hybrid. PMBOK Guide 8th edition (Nov 2025) uses 6 principles and 7 performance domains (Governance, Scope, Schedule, Finance, Stakeholders, Resources, Risk) plus 5 focus areas with about 40 processes. [PMI PMBOK 8; PRINCE2 7; ISO 21502]
- **Programmes and portfolios** — Programme records (benefits, component projects), portfolio prioritisation and capacity-constrained selection. [COBIT BAI01, APO05; ISO 21503/21504]
- **Link to service design and transition** — Projects that deliver new or changed services carry the ISO/IEC 20000-1 §8.5.2 plan items (authorities, activities and timescales, resources, dependencies, testing, acceptance criteria, intended outcomes). Their deliverables enter production only through change and release management, and the service catalogue is updated at transition. [ISO/IEC 20000-1 §8.5.2; FitSM PR1.3]
- **Demand-to-project traceability** — Service proposal → approved demand → project/epic → requirements → releases → changes → deployed CIs. [IT4IT S2P/R2D, 3.0 Explore/Integrate; COBIT BAI02]
- **Agile portfolio flow** — Portfolio Kanban (funnel → reviewing → analysing → ready → implementing → done) with WIP limits, epics with lean business cases, and flow metrics (flow time, velocity, load, efficiency, distribution). [Kanban Method; Flow Framework; SAFe (optional)]
- **Earned value and progress** — PV/EV/AC, SPI and CPI, milestone trend, burn-up/burn-down, and forecast completion. [PMBOK; CMMI V3.0 MC, PLAN, EST]
- **Project risk** — Project risks recorded in the shared risk engine and escalated to the enterprise profile when above threshold. [COBIT BAI11.06; ISO 31000]
- **AI assistance** — Status-report drafting from tasks and changes [AI]; schedule-slip and budget-overrun prediction [AI]; RAID extraction from meeting notes [AI].

### Implementation notes
- Reuse the work-item engine (tasks, boards, dependencies) for project tasks. A "project" is a container with governance fields, so incidents, changes and requests can be linked to project deliverables without data duplication.

## Module: workforce

### Features
- **Competence and awareness records** — For each role:
  - required competence (education, training, experience);
  - per person: competence evidence (certificates, assessments, training records with expiry), gaps and the actions taken (training, mentoring, hiring), with effectiveness evaluated;
  - awareness acknowledgements: SM policy, objectives, services in scope, the person's contribution, and the implications of not conforming.

  ISO requires documented information as evidence of competence. [ISO/IEC 20000-1 §7.1–7.3; ISO/IEC 27001 §7.2–7.3; FitSM GR4.1 "training and awareness activities"]
- **Role model and RACI** — Process roles: SMS owner, SMS manager, process owner and process manager per process, case owners (service, SLA/OLA/UA, report, availability/continuity plan, capacity plan, security risk, security control, customer relationship manager, supplier relationship manager, incident/request, problem, CI, change, release and improvement owners), CAB members and process staff. The RACI validator enforces FitSM's rules: exactly one A per activity row, at least one R, and avoid A and R on the same role for the same activity. [FitSM-3 v3.0.1]
- **Skills framework** — Skills taxonomy with proficiency levels mapped to **SFIA 9** (released Oct 2024): seven levels of responsibility defined by generic attributes (autonomy, influence, complexity, knowledge, business skills and behavioural factors), plus SFIA's AI skills resources. Alternatively the European e-Competence Framework (EN 16234-1). Skills drive routing, rostering and development plans. [SFIA 9; COBIT APO07.03]
- **Staffing and key personnel** — Staffing plans, key-person dependency register (single points of knowledge), contractor management and backfill plans. [COBIT APO07.01–07.02, APO07.06]
- **KCS licensing and coaching** — KCS licence levels (Candidate, Contributor, Publisher), coach assignments, PAR and Content Standard Checklist results per person, and licence renewal/revocation. These drive system rights in the knowledge module, not job grades. [KCS v6 T7.1–7.3]
- **On-call and shift management** — Rosters, shift patterns, follow-the-sun handover notes, on-call compensation records, rest-period rules (EU Working Time Directive and local labour law, unverified per jurisdiction), and load metrics. SRE guidance: ≤25% of time on-call, ≤50% on operational work, ≤2 incidents per 12-hour shift, and rotations large enough that each engineer is on call once or twice a quarter. [Google SRE book ch. 11]
- **Toil tracking** — Engineers tag work as toil (manual, repetitive, automatable, tactical, no enduring value, O(n) with growth). Quarterly toil surveys with a team toil % against the ≤50% cap, and toil-reduction projects. [Google SRE book "Eliminating Toil"]
- **Workload and flow** — Personal and team WIP limits, work-item age alerts, and swarming boards (dispatch, backlog and expert swarms) as an alternative to tiered escalation. [Kanban Method; Consortium for Service Innovation Intelligent Swarming]
- **Contact-centre workforce management** — Volume forecasts by channel and interval, Erlang-C/simulation staffing to service-level targets (e.g., 80% answered in 20 s), schedule adherence, occupancy, shrinkage. [HDI Resources/People Management categories; ISO 18295-1]
- **People satisfaction** — Periodic staff engagement and satisfaction surveys for support teams, an HDI scored category. [HDI Support Center Standard "People Satisfaction"]
- **Lawful use of AI on workers** — AI features that allocate work based on individual behaviour or personal traits, or that monitor and evaluate worker performance or behaviour, are **Annex III point 4(b) high-risk** under the EU AI Act (obligations from **2 Dec 2027** after the Digital Omnibus). They need human oversight, logs kept ≥6 months by the deployer and prior information to workers' representatives and affected workers (Art. 26). **Emotion recognition of workers from biometric data** (voice, face) is prohibited since 2 Feb 2025 (Art. 5(1)(f)). Commission guidance ties emotion recognition to biometric data, so text-only sentiment of tickets is likely outside the ban, but voice-emotion analytics on agents is not. National co-determination rules apply, e.g. Germany's BetrVG §87(1) no. 6 on technical monitoring of employees. [EU AI Act Art. 5, 6, 26, Annex III; GDPR Art. 88]
- **Workforce reporting** — Competence coverage per process and service (bus factor), training completion and expiry, on-call load and fairness (pages per person, night pages), toil %, utilisation, backlog per person (team-level by default), KCS licence distribution, staff satisfaction.
- **AI assistance** — Skills inference from resolved work, offered to the person for confirmation, not as an evaluation [AI]; workload and volume forecasting for staffing [AI]; assignment recommendations based on skills and availability, not behavioural profiling (treated as high-risk if it evaluates individuals) [AI]; coaching suggestions from article-quality samples [AI].

### Implementation notes
- Default to **team-level** performance metrics. Individual metrics need an explicit, documented purpose (KCS coaching, licence decisions), restricted visibility (person + coach/manager) and a retention limit (GDPR Art. 5(1)(b)/(e)). Any AI scoring of individuals is configured as an AI-Act-high-risk use with oversight records.
- Rosters store both the planned and actual on-call person per interval, so page-load metrics attribute correctly after swaps.

## Module: portal

### Features
- **Self-service portal** — Orderable catalogue (filtered by entitlement), knowledge (filtered by KCS audience and state), "my requests/incidents" with progress updates, approvals inbox, service status, surveys, and community/Q&A. It keeps users informed of progress and provides the channels for ordering, escalation and complaints. [FitSM-1 v3.0 PR7.3, PR9.4; ISO/IEC 20000-1 §8.3.2]
- **Omnichannel intake** — Email, web form, chat, virtual agent, phone/IVR, walk-up, mobile app and collaboration tools (Teams/Slack). Each record stores its channel, and every channel creates the same standardised record (FitSM-2 recording procedure: the sources and channels through which incidents and requests can be raised). [FitSM-2 PR9; ISO/IEC 20000-1 §8.6]
- **Service status page** — Public or private status per service/region with subscriptions (email/SMS/RSS). Incident posts are approved via the communication workflow, then followed by maintenance notices and recovery updates. [NIST CSF RC.CO-03/04; EU DORA Art. 14; NIS2 Art. 23(2) communication to recipients of services]
- **Virtual agent with AI disclosure** — The conversational agent tells users they are interacting with AI unless that is obvious (EU AI Act Art. 50(1), applicable from 2 Aug 2026). Generated content is machine-readably marked by GenAI providers (Art. 50(2); grace to 2 Dec 2026 for systems already on the market). It offers an always-available hand-off to a human, transcript retention per the retention schedule, and grounding only in content the user may see. [EU AI Act Art. 50; Digital Omnibus 2026/1744]
- **Accessibility (WCAG 2.2 AA)** — All portal pages meet WCAG 2.2 AA, including the new criteria:
  - 2.4.11 Focus Not Obscured (Minimum);
  - 2.5.7 Dragging Movements;
  - 2.5.8 Target Size (Minimum, 24×24 px);
  - 3.2.6 Consistent Help (help link in the same place on every page);
  - 3.3.7 Redundant Entry (don't ask for information already given in the same process);
  - 3.3.8 Accessible Authentication (Minimum) (no cognitive-function test such as a puzzle CAPTCHA without an alternative; allow paste and password managers).

  AAA options: 2.4.12, 2.4.13, 3.3.9. 4.1.1 Parsing is obsolete in 2.2. The portal also needs an accessibility statement and an accessibility feedback channel. Legal baseline:
  - the European Accessibility Act applies to consumer-facing services since 28 Jun 2025;
  - EN 301 549 V3.2.1 (WCAG 2.1) still carries presumption of conformity;
  - **EN 301 549 V4.1.1** (published 2 Sep 2026, WCAG 2.2 A/AA) awaits citation in the Official Journal, expected around Dec 2026;
  - the public-sector Web Accessibility Directive covers public bodies' portals.

  [W3C WCAG 2.2; Directive (EU) 2019/882; Directive (EU) 2016/2102; ETSI/CEN/CENELEC EN 301 549]
- **Privacy at the point of collection** — Privacy notice links on forms (GDPR Art. 13), consent capture where consent is the lawful basis, cookie consent for non-essential cookies (ePrivacy Art. 5(3)), and a **data-subject request** entry point (access, rectification, erasure, portability, objection) that creates a DSAR case (see admin). [GDPR Art. 12–22]
- **Complaints and compliments** — A visible complaints channel with acknowledgement, tracking, response and closure, kept separate from incidents but linkable. [ISO 10002:2018; FitSM PR7.5; ISO/IEC 20000-1 §8.3.2]
- **Experience surveys** — Post-ticket micro-surveys (0–10 score, lost time, factors) and proactive surveys inside the portal reaching people who never open tickets (HappySignals "Service Portal" area). Results feed XLAs. [HappySignals; ISO/IEC TS 20000-18:2026]
- **Self-service measurement** — Search analytics, "Did this help?", self-service success rate (resolved without a case), case deflection with honest attribution (survey or no-case-within-N-days), and article reuse from self-service. [KCS v6 T5.11–5.12]
- **Localisation** — Multi-language content and UI, RTL layouts, locale calendars and number formats, and plain-language catalogue descriptions. [WCAG 3.1.x; KCS T5.8 global support]
- **AI assistance** — Conversational triage that turns free text into a request item or incident with pre-filled fields [AI]; generative answers with citations from permitted knowledge [AI]; real-time translation of chat and articles [AI]; proactive suggestions ("your laptop warranty ends; order a replacement") [AI].

### Implementation notes
- **One intake API** underlies every channel; channels are adapters. Record `channel`, `channel_message_id` and the raw payload for audit.
- **Accessibility as CI gate:** automated checks per build, manual screen-reader passes (NVDA/JAWS/VoiceOver; LTR and RTL) per release, and an ACR/VPAT per release mapped to WCAG 2.2 and EN 301 549.
- **AI disclosure** is a UI component with fixed placement (also helps WCAG 3.2.6 consistency). Every AI turn is logged with model version and retrieval sources.

## Module: esm

### Features
- **One service model for every department** — ISO/IEC 20000-1:2018 applies to any services, not only IT. USM is built for enterprise service management: the same five processes (agree, change, repair, operate, improve) and eight workflows for every service domain, with "a service = facilities + support" (unverified wording). VeriSM treats the whole enterprise as the service organisation. The platform therefore offers department workspaces that reuse the same record types, SLA engine, catalogue, knowledge and portal, with department-specific forms and fulfilment. [ISO/IEC 20000-1; USM; VeriSM]
- **HR service delivery** — HR cases with case-level confidentiality (restricted to the HR group and named participants) and special-category data handling (health, union membership, biometrics; GDPR Art. 9 conditions and Art. 88 employment context). Employee-relations investigations have restricted access and legal hold. HR knowledge has audiences per country, entity or employee group. [GDPR Art. 9, 88; ISO/IEC 27001 A.5.34]
- **Employee lifecycle orchestration** — Onboarding, moves and offboarding across HR, IT, facilities and security, as one parent case with department tasks. The offboarding checklist covers access revocation, asset return and confidentiality reminders. [ISO/IEC 27001 A.5.11, A.5.18, A.6.5]
- **Facilities management** — FM management system objects: FM policy, objectives, stakeholder requirements, service-delivery records and performance evaluation. Supported work: work orders (reactive and planned preventive maintenance), space and move management, visitor management, physical-access requests and building-sensor events. [ISO 41001:2018; ISO 55001:2024; ISO/IEC 27001 A.7.1–7.4]
- **Health & safety events** — Incident and near-miss reports with investigation, root cause, corrective action, worker participation and statutory reporting fields. [ISO 45001:2018 §10.2]
- **Legal service desk** — Matter intake, conflict checks, privileged/confidential flag (restricted search and AI indexing), contract review requests, and **legal hold** across ITSM records that overrides retention disposal. [ISO/IEC 27001 A.5.33; GDPR Art. 17(3)(e)]
- **Whistleblowing / speak-up channel** — A secure, confidential reporting channel (optionally anonymous) with protection of the reporter's identity, acknowledgement **within 7 days** and feedback **within a reasonable period, not exceeding 3 months**. Case handling is restricted to designated impartial staff, with a full audit trail. [Directive (EU) 2019/1937 Art. 9; ISO 37002:2021; ISO/IEC 42001 A.3.3 reporting of concerns (AI)]
- **Compliance management requests** — Policy questions, conflict-of-interest declarations, gifts and hospitality registers, and compliance obligation tasks. [ISO 37301:2021]
- **Finance and procurement desks** — AP/AR inquiries and purchase requests under delegation-of-authority approvals and segregation of duties. [COBIT APO06; ISO/IEC 27001 A.5.3]
- **Cross-department routing** — Intent classification across departments, shared request types (e.g., a "new hire" bundle), and per-department SLAs/XLAs. [USM; ISO/IEC TS 20000-18]
- **AI assistance** — Cross-department intent routing [AI]; HR-policy Q&A grounded in the employee's country and entity articles only [AI]; confidential-case redaction before any AI processing [AI].

### Implementation notes
- **Confidentiality ceiling.** Each department workspace is a security domain (see Access control): its own groups, roles, data policies and AI-indexing switch. HR, legal and ethics cases default to "restricted" visibility (participants only), so global admins and AI retrieval need explicit, audited grants.
- **Whistleblowing isolation.** Keep the whistleblowing module logically separate (own encryption keys, no cross-module search, reporter identity in a separate vault field). This prevents ordinary admins or analytics from re-identifying reporters.

## Module: csm

### Features
- **Accounts, contacts, entitlements and installed base** — Customer accounts (B2B) and consumers (B2C), contacts with roles, contracts and entitlements (support level, hours, channels, response targets), and products and assets installed at the customer. Every case checks entitlement before SLA assignment. [ISO/IEC 20000-1 §8.3.2–8.3.3; eTOM Customer domain]
- **Case management** — Case lifecycle (new, open, awaiting customer, awaiting internal/engineering, resolved, closed), escalation management (account-level escalations with owner and plan), linked incidents, problems and changes for internal root cause, and proactive notifications to affected customers. [eTOM Assurance: Problem Handling, Customer QoS/SLA Management]
- **Complaints handling** — The ISO 10002 process: receipt, tracking, acknowledgement, initial assessment, investigation, response, communication of the decision, closure. Guiding principles include visibility, accessibility, responsiveness, objectivity, confidentiality, a customer-focused approach, accountability, continual improvement, competence and timeliness. The process is monitored, audited and reviewed. Regulated sectors add deadlines, e.g. PSD2 Art. 101 payment-service complaints answered within 15 business days (35 in exceptional cases) and UK FCA DISP final response within 8 weeks (both unverified for current text). [ISO 10002:2018 (confirmed 2023); ISO 10004:2018 satisfaction monitoring; ISO 10003 external dispute resolution]
- **Contact-centre standards** — Service requirements for customer contact centres: customer communication, staff competence, handling of enquiries and complaints, performance measurement. COPC CX Standard for outsourced/in-house CX operations (current version unverified). [ISO 18295-1:2017/-2:2017; COPC]
- **KCS for customer support** — External audiences (Customers, Public) with the "90/0" target, community-sourced articles, customer-visible known errors, and self-service success measurement. [KCS v6]
- **Telecom/provider interoperability** — eTOM Assurance processes (Problem Handling, Customer QoS/SLA Management, Service Problem Management, Service Quality Management, Resource Trouble Management) and TM Forum Open APIs:
  - TMF621 Trouble Ticket;
  - **TMF724 Incident Management** (v4.0, Sep 2023; TMF724A profile);
  - TMF656 Service Problem Management;
  - TMF642 Alarm Management;
  - TMF638/639 Service/Resource Inventory;
  - TMF620/622 Product Catalog/Ordering;
  - TMF629 Customer and TMF632 Party Management;
  - TMF681 Communication.

  [TM Forum eTOM; Open APIs]
- **Regulated customer notification** — Incidents affecting customers' financial interests trigger client information without undue delay (EU DORA Art. 19(3)). Significant incidents and threats are communicated to service recipients (NIS2 Art. 23(1)–(2)). Personal-data breaches with high risk are communicated to data subjects (GDPR Art. 34). [EU DORA; NIS2; GDPR]
- **Accessible customer support** — Under the European Accessibility Act, support services for in-scope consumer services (help desks, call centres, technical support) must give information on the service's accessibility in accessible formats. Customer portals and chat must meet WCAG 2.2 AA (EN 301 549). [Directive (EU) 2019/882 Annex I]
- **Customer experience metrics** — CSAT, NPS, CES, Happiness/lost time, first-contact resolution, time to first response, time to resolution against entitlement, escalation rate, complaint rate, and repeat contacts. [ISO 10004; HDI; HappySignals]
- **AI assistance** — Case summarisation and suggested replies grounded in KCS articles [AI]; text-based sentiment and escalation-risk scoring (customer-facing, not workplace emotion recognition) [AI]; entitlement extraction from contracts [AI]; AI-disclosed customer chatbots (Art. 50(1)) [AI].

### Implementation notes
- **Entitlement resolution order:** contract line → product → account default. Store the entitlement snapshot on the case, so SLA disputes can be settled with the terms in force at case creation.
- **Complaint flagging** is a classification on any case (not a separate table), so complaint metrics include complaints raised through any channel. Regulated deadlines run as extra clocks.

## Module: analytics

### Features
- **Monitoring, measurement, analysis and evaluation** — The organisation decides what to measure, methods, timing, and when results are analysed and evaluated. The metric library stores each KPI's definition, formula, owner, data source, frequency, target and thresholds. [ISO/IEC 20000-1 §9.1; ISO/IEC 27001 §9.1; FitSM GR6.1; COBIT MEA01.01–01.03]
- **Report register and delivery** — Reports are specified (identity, purpose, audience, frequency, content, format, delivery method) and agreed with recipients. They are produced and delivered on schedule with delivery evidence, cover performance, significant events, nonconformities and trends, and lead to recorded decisions and actions. [FitSM PR3.1–3.3; ISO/IEC 20000-1 §9.4]
- **Management review pack** — Auto-compiled inputs:
  - status of previous actions;
  - changes in internal and external issues;
  - performance trends: nonconformities and corrective actions, monitoring results, audit results;
  - customer feedback and satisfaction;
  - performance of other parties;
  - adequacy of resources;
  - effectiveness of risk actions;
  - improvement opportunities.

  Outputs (decisions, SMS changes, resource needs) are captured as actions. [ISO/IEC 20000-1 §9.3; ISO/IEC 27001 §9.3; FitSM GR1.3]
- **Nonconformity, corrective action and improvement register** — Nonconformities from audits, reviews, incidents and complaints get containment, root cause, corrective action, effectiveness check and closure. Improvement opportunities are recorded, evaluated against criteria, prioritised, approved, implemented with targets (quality, value, capability, cost, productivity, resource use, risk reduction) and measured. The register has an improvement owner per item. [ISO/IEC 20000-1 §10.1–10.2; FitSM-1 v3.0 PR14.1–14.3, GR7.1–7.2; COBIT APO11.05, MEA01.05]
- **Canonical metric packs** —
  - **DORA metrics**: change lead time, deployment frequency, failed deployment recovery time, change fail rate, deployment rework rate.
  - **SRE**: SLO attainment, error-budget remaining and burn rate, toil %, pages per shift.
  - **KCS**: link rate, link accuracy, Contribution Index, 90/0, self-service success, time to publish.
  - **XLA**: Happiness, perceived lost time, factor distribution.
  - **Kanban/flow**: WIP, throughput, cycle-time percentiles, work-item age, cumulative flow diagram, blocked time, flow efficiency.
  - **Flow Framework**: flow velocity, time, load, efficiency, distribution.
  - **Value-stream mapping**: lead time, process time, %complete & accurate, activity ratio, rolled %C&A.
  - **HDI support centre**: FCR, ASA, abandonment, cost per ticket, customer and people satisfaction.
  - **Security/compliance**: CSF profile gap, control effectiveness, vulnerability SLA.

  [dora.dev; SRE Workbook; KCS v6; HappySignals; Kanban University; Flow Framework; HDI]
- **COBIT goals cascade and capability** — Stakeholder drivers → enterprise goals (EG01–EG13) → alignment goals (AG01–AG13) → governance and management objectives, with example metrics per goal. **Capability levels 0–5** per process (activities in COBIT 2019 are tagged with the capability level they support) and **maturity levels 0–5** per focus area. Assessment workspaces record evidence per practice and activity. **Design factors** (enterprise strategy, enterprise goals, risk profile, I&T-related issues, threat landscape, compliance requirements, role of IT, sourcing model, IT implementation methods, technology adoption strategy, enterprise size) drive which objectives get priority and target capability. COBIT 7 (reported launched 27 Oct 2026) adds design factors on organizational health and information/data strategies and a three-tier assessment module (unverified at ISACA source). [COBIT 2019 Framework and Design Guide]
- **CMMI appraisal support** — Practice-area evidence collection (CMMI V3.0: 31 practice areas, including Service Delivery Management, Strategic Service Management, Incident Resolution & Prevention, Continuity, Managing Performance & Measurement, Causal Analysis & Resolution), objective evidence per practice and sample, and process performance baselines for higher maturity. [CMMI V3.0]
- **HDI Support Center Standard scorecard** — Evidence and scoring across the eight categories: Leadership, Policy & Strategy, People Management, Resources, Processes & Procedures, People Satisfaction, Customer Satisfaction, Performance Results. [HDI]
- **DORA AI capabilities** — Self-assessment of the DORA AI Capabilities Model's seven capabilities (clear and communicated AI stance; healthy data ecosystems; AI-accessible internal data; strong version control practices; working in small batches; user-centric focus; quality internal platforms), next to the 2025 team-archetype view that replaced fixed elite/high/medium/low tiers (capability names as recalled, verify). [DORA 2025]
- **Data quality and lineage** — Every KPI value is traceable to its source query, filters, formula version and data timestamp. Data-quality checks (completeness of required classification fields, timestamp sanity) are flagged on dashboards. [COBIT APO14; ISO/IEC 20000-1 §9.1]
- **Role dashboards** — Operational (queues, SLA risk), tactical (trends, backlog, change success), strategic (service health, XLA, cost, risk, compliance posture), and regulator/auditor views with period locking.
- **AI assistance** — Natural-language questions that compile to governed queries over permitted data [AI]; anomaly and trend detection with narrative explanations [AI]; forecasting of volumes, breaches and costs [AI]; drafting of service reports and management review packs with citations to underlying figures [AI].

### Implementation notes
- **Formula versioning.** `metric(id, version, formula_sql/dsl, unit, direction, valid_from)`. Snapshots store the metric version; recomputing a closed period with a new formula creates a new series, never an overwrite.
- **Row-level security** applies in analytics exactly as in operational views: aggregated queries filter by the caller's data scope first. Small-cell suppression applies (e.g., survey groups < 5) for privacy.
- **Percentiles over averages** for time-based measures (cycle time, resolution time). Store distributions (histograms or t-digests) per period to support percentile queries efficiently.
