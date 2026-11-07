# Change enablement, release and deployment, DevOps, projects and portfolio

Consolidated, deduplicated feature catalog for module group **g3** (keys `change`, `release`, `devops`, `project`). It merges the research reports `itil.md`, `standards.md`, `servicenow.md`, `jsm.md`, `freshservice.md`, `bmc_manageengine.md`, `others.md`, `ai.md`, `access.md` and `analytics_ux.md` (snapshot 2026-11-07). Each feature appears once, in its best and most complete form, with the tools and frameworks that have it.

**Scope and boundaries**
- `change`: change enablement (ITIL 4; ISO/IEC 20000-1 §8.5.1; COBIT BAI06): models, risk, authority and CAB, schedule, windows, conflicts, implementation, PIR, compliance.
- `release`: release management, deployment management and service validation and testing (ITIL 4; ISO/IEC 20000-1 §8.5.2–8.5.3; COBIT BAI07; IT4IT Deploy/Release).
- `devops`: software development and management, high-velocity IT, toolchain and pipeline integration, deployment gating, DORA and flow metrics, reliability and platform engineering.
- `project`: projects, programmes and portfolios, ideas and demand, strategy/OKRs, resources and time, project financials, benefits, OCM and business analysis (ITIL 4; ISO 21502–21504; PRINCE2 7; PMBOK 8; COBIT BAI01/BAI11/APO05).
- Owned by other groups and only consumed here: CMDB graph and discovery (`cmdb`); SLO/SLI and error-budget computation (`slm`); monitoring events and alert suppression (`event`); incident PIR and postmortems (`incident`/`problem`); toil, skills and shifts (`workforce`); cost models, chargeback and expense lines (`financial`); service, application and technology portfolio, EA (`service_portfolio`); promotion of tenant configuration between environments (`admin`); the generic record, approval, flow and notification engines (`platform`).

**Conventions**
- Feature IDs: `CHG-nnn`, `REL-nnn`, `DEV-nnn`, `PRJ-nnn`. They are catalog IDs, not record numbers (record prefixes are listed under each Data model).
- Tier: **P0** = must have for an enterprise ITSM v1 · **P1** = strong differentiator we should build · **P2** = later or optional.
- `ai: yes` means the feature includes a generative, ML or agentic capability. AI never authorizes a change, never passes a gate on its own and only writes proposals that go through the normal write path (grants, field rules, transitions, SoD, audit). Every AI feature runs on the tenant's own model (cloud or local) and degrades gracefully when AI is off.
- `E01`–`E25` refer to shared engine capabilities defined in **Engine requirements** at the end.
- All dates are Jalali-first (Gregorian on demand), all UI is Persian RTL, and all scheduling uses business calendars that include Iranian official holidays.
- Source tags: **SN** ServiceNow · **JSM** Jira Service Management / Atlassian · **FS** Freshservice · **BMC** BMC Helix ITSM · **SDP** ManageEngine ServiceDesk Plus · **Halo** HaloITSM · Ivanti · Xurrent · TOPdesk · GLPI · iTop · Znuny · RT (Request Tracker) · InvGate · SolarWinds · BigPanda · Dynatrace · NetBox · Zammad. Frameworks: ITIL 4 / ITIL v5, ISO/IEC 20000-1, COBIT 2019, FitSM, SIAM BoK, IT4IT, MOF, USM, DORA metrics, Google SRE, ISO/IEC 27001, SOC 2, PCI DSS 4.0.1, EU DORA, NIST CSF 2.0, ISO 21502/21503/21504, PRINCE2 7, PMBOK 8, SAFe, Flow Framework, CMMI, ISO 31000, ISO/IEC 42001.

## Module: change — توانمندسازی تغییر

Change enablement maximizes the number of successful changes by assessing risk properly, authorizing changes through the right authority and managing the change schedule (ITIL 4). One record type (`change_request`) runs many configurable change models; risk, authority, conflicts and evidence are computed by shared engines so standard, normal, emergency and pipeline changes all use the same data.

### Features

#### CHG-001 · Change request (RFC) record
- **name_fa:** رکورد درخواست تغییر (RFC)
- **group:** Records and lifecycle
- **description:** The central record. Fields: number, type, change model, category/subcategory/item, requester, requested-for, opened-by, change owner/coordinator, change manager, assignment group and assignee, implementer group, department/company/location, short description, description, reason for change and business justification, expected outcome and benefits, service and service offering, affected CIs and computed impacted services, priority, impact, urgency, risk (calculated, with override and reason), planned start/end, actual start/end, maintenance window, expected outage/downtime, implementation plan, test plan and test evidence, backout/remediation plan with a "tested" flag and evidence, communication plan, planned effort and cost, CAB required / CAB date / CAB recommendation, conflict status and last run, on-hold flag and reason, approval status, close code and close notes, PIR result, workspace. Plans are rich text with attachment slots; tenants add custom fields through metadata.
- **sources:** ITIL 4; ISO/IEC 20000-1 §8.5.1.2–8.5.1.3; COBIT BAI06.01; PCI DSS 6.5.1; SN; JSM; FS; BMC; SDP
- **tier:** P0 · **ai:** no
- **implementation:** Table `change_request` (prefix CHG) on E01 with the standard secured-record columns. `risk_source` (calculated/manual) and `risk_override_reason` are audited (E14). Impacted services are refreshed by E07 and conflicts by E08 workers. Form layout per model via E02 field policies.

#### CHG-002 · Creation channels and origin linking
- **name_fa:** ایجاد تغییر از مسیرهای مختلف و پیوند با منشأ
- **group:** Records and lifecycle
- **description:** A change can be raised from the agent workspace, the portal (standard changes as orderable catalog items), e-mail, the API, a CI/CD pipeline or a calendar slot, or converted from an incident, problem/known error, service request, release, project task, alert or CI. The originating record is linked ("initiated by") and its context (CIs, description, attachments) is copied through mapping rules. "Copy change" duplicates a change with a choice of which stages and sections to copy. Conversational creation is CHG-072.
- **sources:** ISO/IEC 20000-1 (originating record); ITIL 4; SN; FS; SDP (copy change with stage selection); BMC; JSM
- **tier:** P0 · **ai:** no
- **implementation:** E09 flow action "create change from X" with field-mapping templates (E24); `origin_type`/`origin_id` plus `record_link(kind=initiated_by)`; copy uses section selection over the model's field groups.

#### CHG-003 · Change types and classes
- **name_fa:** انواع و طبقه‌های تغییر
- **group:** Records and lifecycle
- **description:** Out-of-the-box types Standard (pre-authorized), Normal (assessed and authorized) and Emergency (expedited). Optional classes used by leading tools: Minor, Major, Significant, Expedited, Latent/retrospective, No-impact, Change registration (log-only) and a generic "Model" type. Types are renamable, can be disabled, carry a colour and select the default change model. The type can be changed only while the change is New and has no approvals.
- **sources:** ITIL 4; COBIT BAI06.02; ISO/IEC 20000-1 §8.5.1.1; SN; FS (Minor/Standard/Major/Emergency); BMC (Expedited, Latent, No Impact); SDP (Minor/Major/Significant); JSM
- **tier:** P0 · **ai:** no
- **implementation:** `change_type` reference table (key, label_fa, colour, default_model_id, active); an option rule (E13) allows editing `type` only when state = new and no approvals exist.

#### CHG-004 · Configurable change models
- **name_fa:** مدل‌های تغییر قابل پیکربندی
- **group:** Records and lifecycle
- **description:** A change model is a repeatable approach for a kind of change: its own state model (states with initial and implementation flags), transitions with conditions (field conditions or scripts), required fields per transition, record presets (type, assignment group, template), linked flows (authorize, review), attributes (CI edits allowed after authorization, which states count as implementation), an assigned ITIL process so the API picks the right model, and an active flag. Models can be two-level (stage → status), with stages such as Submission, Planning, CAB evaluation, Implementation, UAT, Release, Review and Close that can be renamed or skipped (only Submission and Close mandatory). Definitions are versioned (draft → publish); in-flight changes keep the version they started with; the record shows a lifecycle bar with only reachable states. Examples: "Cloud provisioning" (low risk goes straight to Implement), "Database change", "Firewall rule change".
- **sources:** ITIL 4 (change model); SN (Yokohama/Brazil change models, state transitions); FS (Change Lifecycle builder, versioned publishing); SDP (8-stage lifecycle); BMC; Znuny (process-driven change); TOPdesk (simple vs extensive change); Xurrent (workflow templates)
- **tier:** P0 · **ai:** no
- **implementation:** Config tables `change_model`, `change_model_state`, `change_model_transition` on E02, versioned; `change_request.model_version_id` is a snapshot. The status dropdown is computed from outgoing transitions. Visual model editor reuses the flow builder (E09/E16); lifecycle bar component (E16).

#### CHG-005 · Reference lifecycles and re-authorization
- **name_fa:** چرخه‌های عمر مرجع و تأیید دوباره پس از تغییر دامنه
- **group:** Records and lifecycle
- **description:** Shipped ITIL-aligned models: Normal New → Assess → Authorize → Scheduled → Implement → Review → Closed; Standard New → Scheduled → Implement → Review → Closed; Emergency New → Authorize (emergency authority) → Implement → Review → Closed. Cancel is allowed from any state except Review and Closed. "Revert to New" cancels pending approvals; a rejected change returns to New or is resubmitted to the rejecting phase ("Restart"). Editing scope, CIs, plans or planned dates after authorization sends the change back to Assess/Authorize and invalidates the approvals. State categories: New = new; Assess, Implement = active; Authorize, Scheduled, On hold = waiting; Review = resolved; Closed = closed; Canceled = canceled.
- **sources:** ITIL 4; SN (state model, revert to New); BMC (Restart to rejecting phase); JSM; FS; SDP
- **tier:** P0 · **ai:** no
- **implementation:** Seed models in E02. Re-authorization is an E03 rule on watched fields (`affected_cis`, `planned_*`, plans) while state ∈ {scheduled, implement-before-start}: transition back and set `approval.status = invalidated` (E04).

#### CHG-006 · Status reasons and on-hold handling
- **name_fa:** دلیل وضعیت و توقف موقت
- **group:** Records and lifecycle
- **description:** Each state can require a reason from a configurable list, e.g. Implementing: In rollout / In test / In rollback / In verification / In documentation; Pending: Vendor purchase / Manager intervention / Support group communication / Task review; Rejected: Insufficient change data / Insufficient task data / Schedule conflicts; Cancelled: No longer required / Resources not available / To be re-scheduled / Funding not available. "On hold" is a flag with a mandatory reason (also set automatically by lockdown); a held change cannot be cancelled until released (configurable).
- **sources:** BMC (status reasons, Pending rules); SN (On hold and reason); JSM (Pending reason); SDP
- **tier:** P0 · **ai:** no
- **implementation:** `status_reason` reference per (model, state) in E02; `on_hold`, `on_hold_reason`, `on_hold_since`; SLA pause conditions (E10) can use the reason.

#### CHG-007 · State field policies and field locks
- **name_fa:** سیاست فیلدها بر اساس وضعیت و قفل فیلدها
- **group:** Records and lifecycle
- **description:** Per model and state, fields are mandatory, read-only or hidden: e.g. backout plan mandatory before Authorize, implementation plan locked once Scheduled, close code mandatory to close; after Closed only a change admin may edit non-structural fields and never type, status, dates or tasks. Template field policies narrow this further for standard changes. Enforced identically on form and API.
- **sources:** SN (state field policies, template field policies); FS (lock fields per status); SDP (form rules across stages, disable actions on closed changes); BMC (post-closure edit limits)
- **tier:** P0 · **ai:** no
- **implementation:** `state_field_policy(model_version, state, field, mode)` evaluated by E02 on read (UI affordance) and on write (server re-validation, field-level errors).

#### CHG-008 · Transition gates and automatic progression
- **name_fa:** دروازه‌های گذار و پیشروی خودکار
- **group:** Records and lifecycle
- **description:** Transitions carry gate conditions: all tasks closed, all approval groups approved (per chain rule), mandatory fields filled, risk assessed, readiness checks passed, conflicts resolved or acknowledged, PIR completed. Phases without approvers auto-advance; when all implementation tasks close the change moves to Review ("final review required"); backward moves are blocked while tasks are in progress; changes left in Review auto-close after N days; stale drafts auto-cancel.
- **sources:** FS (transition conditions); BMC (auto-advance, Auto-Close Days, blocked backward moves); SN (tasks closed before Review); SDP (closure rules per stage)
- **tier:** P0 · **ai:** no
- **implementation:** Gate = condition AST (E03) on `change_model_transition`; automatic transitions by E08 jobs and E09 triggers; every gate evaluation is logged (E14).

#### CHG-009 · Change policy and lead-time rules
- **name_fa:** خط‌مشی تغییر و قواعد حداقل زمان اعلام
- **group:** Records and lifecycle
- **description:** A versioned change-management policy defines what is under change control (services, CI classes, documentation, processes, supplier relationships), change categories and how each is managed, criteria for major-impact changes (new or removed services, service transfers) that must go through service design and transition (REL-032), and minimum notice per type and risk (e.g. high-risk normal change ≥ 5 business days before planned start). Changes submitted inside the lead time are flagged "late" and need an extra approval or become expedited. The active policy version is stamped on each change.
- **sources:** ISO/IEC 20000-1 §8.5.1.1; FitSM PR12.1–12.2; COBIT BAI06; analytics_ux (late changes KPI)
- **tier:** P0 · **ai:** no
- **implementation:** `change_policy` (version, scope conditions, category rules, lead-time rules, major-impact criteria) with E03 conditions; lead time computed on the business calendar (E06); `is_late` and `policy_version_id` on the change.

#### CHG-010 · Change templates
- **name_fa:** الگوهای تغییر
- **group:** Records and lifecycle
- **description:** Templates per type or model prefill fields, plans, checklists, affected CI classes, task templates and task groups, attachments and form layout (sections per stage). Usable from the agent form, the portal and the API. Only members of the template's authoring group may modify it; templates are versioned and audited.
- **sources:** SDP (templates per change type with stage sections); BMC (template authoring group); SN (change templates for models, Australia); FS (form templates)
- **tier:** P0 · **ai:** no
- **implementation:** E24 templates with snapshot instantiation: `change_template(model_id, version, fields jsonb, task_templates[], authoring_group_id)`; edit rights via E13 owner group.

#### CHG-011 · Standard change catalogue
- **name_fa:** کاتالوگ تغییرات استاندارد (از پیش مجاز)
- **group:** Records and lifecycle
- **description:** Library of pre-authorized change templates (e.g. "restart an application pool", "monthly OS patching", "add a firewall object") with owner, risk assessed once when the template is created, version, read-only and mandatory field lists, allowed CI classes and services, maximum duration, periodic review date, usage and success statistics. Templates follow a proposal lifecycle (propose new / modify / retire → review → approval → publish), can be proposed by any agent, and are orderable from the portal and the request catalogue. Instances skip assessment and authorization but record the template's authorization reference, still run conflict checks and respect blackout windows.
- **sources:** ITIL 4; COBIT BAI06; USM; SN (Standard Change Catalog, template proposals); JSM (auto-approve standard changes); FS; BMC; SDP (pre-approved changes)
- **tier:** P0 · **ai:** no
- **implementation:** `standard_change_template` (prefix STD) and `standard_change_proposal` (STDP); proposals approved via E04; catalog publication via E24 and the portal; instances store `std_template_version_id`; statistics from E15.

#### CHG-012 · Standard-change candidates and automatic demotion
- **name_fa:** پیشنهاد الگوی تغییر استاندارد و تنزل خودکار الگو
- **group:** Records and lifecycle
- **description:** The system detects repeatable normal changes that keep succeeding (same model, CI class and similar plans, at least N successes, no caused incidents) and proposes them as standard-change templates, with an AI-drafted template. Conversely, a standard template whose instances fail or cause incidents above a threshold is suspended or demoted to normal automatically and its owner is asked to review it.
- **sources:** ITIL 4 (PIR feeds standard-change candidacy; demotion on repeated failure); SN Brazil (ML suggests standard change templates)
- **tier:** P1 · **ai:** yes
- **implementation:** Nightly E08 job clusters closed changes with embeddings (E19) plus rules; proposals created as `standard_change_proposal(source=ai)`; demotion rule in E03 over template statistics; owner notified (E11).

#### CHG-013 · Emergency change path
- **name_fa:** مسیر تغییر اضطراری
- **group:** Records and lifecycle
- **description:** Expedited path for urgent fixes (major incident, security patch): skips Assess; requires authorization by an emergency authority (ECAB or named emergency approvers; a quorum of one if policy allows); may be implemented before documentation is complete, but Review enforces completion of plans and evidence and a mandatory PIR. Emergency changes may override blackout windows with a reason and are exempt from error-budget gates; their share is monitored (target below 5–10%).
- **sources:** ITIL 4; COBIT BAI06.02; ISO/IEC 20000-1; SN; BMC; FS (emergency CAB); JSM
- **tier:** P0 · **ai:** no
- **implementation:** Seed emergency model (E02) with a `docs_deferred` flag; the Review gate requires the deferred fields and the PIR (E03); ECAB authority rows in CHG-029; blackout override logged via E13/E14.

#### CHG-014 · Retrospective (latent) change registration
- **name_fa:** ثبت تغییر پس از اجرا (تغییر معوق)
- **group:** Records and lifecycle
- **description:** Records a change that was already implemented (during an outage, or found by drift detection or audit). It starts at Review with actual dates, requires a justification and an approving manager, and is counted separately (and as unauthorized unless linked to an approved emergency). A "change registration" model covers log-only operational changes.
- **sources:** BMC (Latent class jumps to Completed); SN (Change Registration model); COBIT BAI06
- **tier:** P1 · **ai:** no
- **implementation:** Model `latent` with initial state Review; `is_retrospective`, `discovered_by` (manual, drift, audit); feeds CHG-056 metrics.

#### CHG-015 · Change tasks and task groups
- **name_fa:** وظایف و گروه‌وظایف تغییر
- **group:** Records and lifecycle
- **description:** Child tasks (planning, implementation, testing, validation, communication, review, custom types) with their own state, assignment group/assignee, planned and actual dates, dependencies and sequencing, parallel task groups, task and task-group templates, and staged tasks prepared during planning. At Implement the first tasks activate automatically; completion of all tasks gates Review. Tasks appear on implementers' work lists and calendars.
- **sources:** ITIL 4; SN (change_task); BMC (tasks, task groups, staging); SDP; FS
- **tier:** P0 · **ai:** no
- **implementation:** `change_task` (prefix CTASK) on E01/E02 with `parent_id`, `seq`, `depends_on[]`, `task_group_id`; activation via E09; gating via E03.

#### CHG-016 · Change relationships
- **name_fa:** ارتباط تغییر با سایر رکوردها
- **group:** Records and lifecycle
- **description:** Typed many-to-many links: initiated by (incident, problem, known error, request, alert); fixes (problem, known error); caused (incidents caused by the change); part of (release, project, project task); affects (CIs, assets, services, offerings); deployed by (deployments, pipeline runs, commits, pull requests); parent/child (scaled change); related risks, knowledge articles and runbooks. Each link shows on both records with counts and quick filters.
- **sources:** ITIL 4; FS (associations); SDP (associations incl. parent-child); SN; JSM; BMC
- **tier:** P0 · **ai:** no
- **implementation:** E01 `record_link(from_type, from_id, to_type, to_id, kind, created_by)` with per-kind cardinality; link kinds drive metrics (caused-by) and access inheritance (release ← change).

#### CHG-017 · CMDB impact analysis and impacted services
- **name_fa:** تحلیل اثر از روی CMDB و سرویس‌های متأثر
- **group:** Impact and risk
- **description:** Affected CIs are picked with suggestions; the system traverses the CMDB graph (depends-on/used-by, direction-aware, depth N, criticality weights) to compute impacted CIs, technical and business services, offerings, customers, SLAs and critical business processes (EU DORA critical or important functions). "Refresh impacted services" recomputes; an impact simulator previews the blast radius before saving; a service-graph view shows upstream and downstream dependencies with active incidents and other scheduled changes.
- **sources:** ITIL 4; ISO/IEC 20000-1 §8.5.1.3; SN (Affected CIs, Impacted services); BMC (impact simulation, indirect collisions); JSM (affected services, Prevention Center service graph); FS (CMDB impact visibility)
- **tier:** P0 · **ai:** no
- **implementation:** `change_affected_ci`, `change_impacted_service` (computed, with path and weight). E07 traversal API with depth limits and caching; recompute on CI edits via E08; graph UI in E16.

#### CHG-018 · Planned outages and downtime
- **name_fa:** قطعی برنامه‌ریزی‌شده و زمان توقف
- **group:** Impact and risk
- **description:** During planning the change declares expected outages per CI or service (planned outage or degradation, start/end). These become outage records shown on CI and service availability, the status page and the portal; downtime announcements go to affected users; availability reporting excludes approved planned outages where the SLA allows; monitoring alerts for CIs inside an active planned outage are suppressed by the event module.
- **sources:** SN (outages from changes, Change outage assistant); SDP (downtime configuration, planned downtime announcements); FS (maintenance alert suppression); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** Shared `ci_outage` table (with `cmdb`/`slm`) with `source_change_id`; announcements via E11; suppression contract (window + CI set) with the event module.

#### CHG-019 · Risk assessment questionnaire
- **name_fa:** پرسشنامه ارزیابی ریسک
- **group:** Impact and risk
- **description:** Admin-defined questionnaires (multichoice, yes/no, rating, number ranges, text, info messages; up to ~50 questions; branching; multilingual) with weighted answer values and derived factors (priority and criticality of related CIs, change impact, performance rating of the team). The aggregate maps to a risk level (e.g. Level 1–5 or Low/Moderate/High/Very High). "Fill out risk assessment" on the form; a risk report lists questions, answers, derived factors and the aggregate. Questionnaires can be duplicated or drafted by AI (CHG-025).
- **sources:** SN (risk assessments); BMC (weighted questions, Risk Level 1–5, Change Risk Report); FS (risk surveys); SDP (risk questionnaire); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** E05 questionnaire engine; `change_risk_assessment(change_id, questionnaire_version, answers jsonb, score, level)`; scoring via E03.

#### CHG-020 · Risk engine: policies, profiles, rules and combination
- **name_fa:** موتور ریسک: سیاست‌ها، پروفایل‌ها، قواعد و ترکیب نتایج
- **group:** Impact and risk
- **description:** Several independent risk engines run and their results are combined: (1) ordered risk conditions that set risk and impact (e.g. tier-1 service during business hours → High); (2) risk profiles, i.e. parameter rules (priority, maintenance-window association, blackout overlap, documentation completeness, CI criticality, number of CIs) each scored 0–10 with weights summing to 100; (3) the questionnaire (CHG-019); (4) probability-based risk (CHG-021); (5) ML prediction (CHG-023). Risk policies (global or per workspace; match all/any; first match in drag-and-drop order) choose the engines and the combination: highest severity, maximum or weighted average (e.g. 70/30). Scores map to configurable bands (e.g. Low 0–25 … Very High 76–100). Risk is re-evaluated on every relevant update until Closed; a basic risk-awareness fallback applies when no policy matches; manual override needs a reason and is audited; risk drives approval routing and business rules.
- **sources:** SN (Change Risk Calculator: risk conditions, assessments, calculated risk, ML; highest result wins); FS (change risk policies, risk profiles, surveys, weighted average); Halo (configurable risk score); SDP (risk via business rules); JSM (legacy automated risk assessment); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** `change_risk_policy`, `change_risk_profile`, `change_risk_result(change_id, engine, score, level, inputs_hash, explanation jsonb, computed_at)`; E03 scoring; recompute via an E09 trigger on watched fields; combination function stored per policy; override fields on `change_request`.

#### CHG-021 · Probability-based calculated risk
- **name_fa:** ریسک محاسبه‌ای بر پایه احتمال موفقیت
- **group:** Impact and risk
- **description:** Risk = lookup(success-probability band × impact). The band (High/Medium/Low probability of success) comes from ordered definitions such as "team success score ≥ X", "change-model success rate ≥ Y" or "CI-class success rate"; a configurable 3×3 lookup table maps band and impact to risk. The matched definition and values are stored and shown as the explanation.
- **sources:** SN (Calculated Risk Score: Impact + Success Probability / Change Success Score / Change Model Success)
- **tier:** P1 · **ai:** no
- **implementation:** E03 decision table `risk_probability_lookup`; inputs from CHG-022 and model/CI statistics (E15 snapshots); written as engine `calculated` in `change_risk_result`.

#### CHG-022 · Team change success score
- **name_fa:** امتیاز موفقیت تغییر تیم‌ها
- **group:** Impact and risk
- **description:** A credit-score-like rating per assignment group (optionally per change model and CI class), rebuilt daily from outcomes over a rolling window: successful closures, unsuccessful or backed-out changes, changes that caused incidents, emergency and unauthorized share. Four configurable colour bands; a score badge next to the assignment-group field; dashboards for team, type and model success. Policies can give high-scoring teams lighter approval paths (CHG-029, CHG-034).
- **sources:** SN (Change Success Score, formula indicators, daily job, four bands); analytics_ux
- **tier:** P1 · **ai:** no
- **implementation:** `change_success_score(group_id, model_id?, day, score, band, components jsonb)` from an E08 daily job over E15 indicators; normalization and band thresholds per tenant.

#### CHG-023 · ML change-failure prediction
- **name_fa:** پیش‌بینی شکست تغییر با یادگیری ماشین
- **group:** Impact and risk
- **description:** A per-tenant model predicts P(fail), where failure = unsuccessful, backed out, or caused an incident within 7 days. Features: model/type, lead time, window length, weekend/night, number and criticality of CIs, blast radius (downstream CIs within 2 hops weighted by service tier), smoothed failure rate of CI, team and assignee ((fails+1)/(changes+2)), collision flag, inside blackout, plan-quality score, pipeline signals (tests passed, deployment history), recent incidents on the CIs. The calibrated probability maps to tenant bands; the top 3 factors are shown; the two most likely risk levels are suggested. Retrained monthly; model version and factors are persisted on the change.
- **sources:** SN (ML risk assessment, Brazil); SDP (Zia Change Risk Prediction, top-2 levels); InvGate (predictive risk and impact); BigPanda (change risk management); BMC (Change Risk Advisor); ITIL v5 (AI risk assessment); ISO/IEC 42001 A.6.2.8
- **tier:** P1 · **ai:** yes
- **implementation:** E20 pipeline (logistic regression or GBM with SHAP, isotonic calibration); written as engine `ml` in `change_risk_result` with `model_version`; computed with system privileges, but evidence (similar changes, incidents) is rendered only if the viewer may read it (E13).

#### CHG-024 · AI risk explanation
- **name_fa:** توضیح هوشمند سطح ریسک
- **group:** Impact and risk
- **description:** A Persian narrative of why the change has its risk level: which condition fired, the questionnaire answers that weighed most, ML top factors, plan gaps, similar past changes and the incidents they caused, conflicts and blackout proximity. It may reference only the provided factors; the input set is configurable; it is regenerated when the risk changes and appears in the risk panel and the CAB pack.
- **sources:** SN (Change risk explanation); JSM (Ops Expert narrative); BMC (Change Risk Advisor summaries)
- **tier:** P0 · **ai:** yes
- **implementation:** E17 skill `change.risk_explain`, grounded on `change_risk_result` rows and ACL-filtered similar changes (E19); stored as an AI artefact with sources; regenerated on risk change via E09.

#### CHG-025 · AI answers for risk questionnaires and compliance fields
- **name_fa:** پاسخ پیشنهادی هوش مصنوعی به پرسشنامه ریسک و فیلدهای انطباق
- **group:** Impact and risk
- **description:** Suggests an answer with reasoning for each risk question from the change fields and configurable "AI risk data sources" (affected CIs, impacted services and business applications, offerings, active change tasks, linked outages). Fills conditional compliance fields (control questions for regulated systems, data classes touched) and shows its reasoning; the user accepts or edits each answer. Also drafts new questionnaires from a policy document.
- **sources:** SN (risk assessment answers generator, AI auto-completion of the compliance dynamic schema); FS (Freddy-generated risk surveys)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skill `change.risk_answers` returning one proposal per question; field set and data sources configured per tenant; accepted answers saved through the normal write path (E13).

#### CHG-026 · Multi-dimension AI risk assessment with mitigations
- **name_fa:** ارزیابی ریسک چندبُعدی با هوش مصنوعی و پیشنهاد اقدام کاهشی
- **group:** Impact and risk
- **description:** On-demand or automatic assessment (Low/Medium/High plus a confidence score and a narrative) across four dimensions. Technical: similar incidents and PIRs, failed deployments and rejected changes on the same service in the last 90 days, plan quality, data migration and compatibility, basic static analysis of linked pull requests. Operational: scheduling conflicts, owners and stakeholders affected, infrastructure changes such as authentication/DNS/CDN, rollback complexity. Compliance and security: identity boundaries, personal or regulated data flows. Business: revenue or billing exposure, SLA penalties, reputation. Mitigations mined from similar failed changes can be accepted, which creates a change task titled with the change number; "reassess" after adding context. Runs with the viewing user's permissions and never approves or rejects.
- **sources:** JSM (Ops Expert AI risk assessment, Prevention Center four dimensions); BMC (Change Risk Advisor, AIOps health); BigPanda (change risk); ai.md
- **tier:** P1 · **ai:** yes
- **implementation:** E18 agent with read tools (records, CMDB graph, dev data, KB) and one write tool "propose task"; each run stored with inputs hash and viewer; admins choose knowledge sources and dimensions; mitigations from kNN over failed changes (E19).

#### CHG-027 · Risk insights panel
- **name_fa:** پنل بینش ریسک
- **group:** Impact and risk
- **description:** Deterministic side panel on every change with affected CIs/services and planned dates: risk summary; conflicting changes in the window and up to 7 days after; maintenance and freeze windows; open and recently resolved incidents and problems on the affected services; failure history (failed or backed-out changes and failed deployments on the same service, the requester's rejection history); SLA and error-budget status of the services. Tabs are configurable per workspace. It works with AI switched off.
- **sources:** JSM (risk insights panel: summary, changes, incidents, failures); SN; analytics_ux
- **tier:** P0 · **ai:** no
- **implementation:** E16 side panel fed by indexed queries (E07 plus the E06 interval index); cached per change for a few minutes; evaluated under the viewer's ACL.

#### CHG-028 · Risk calibration and model governance
- **name_fa:** کالیبراسیون ریسک و حاکمیت مدل
- **group:** Impact and risk
- **description:** Predicted risk versus actual outcome is kept for every change. Reports: reliability diagram, Brier score, band versus actual failure rate per engine and model, with threshold tuning and what-if. Model card (training window, features, metrics), drift alerts and approval of a new model version before activation; an audit of which rule produced which risk.
- **sources:** analytics_ux (risk_predicted vs outcome calibration); ai.md; ISO/IEC 42001; EU AI Act (governance)
- **tier:** P1 · **ai:** yes
- **implementation:** E20 model registry plus E15 calibration reports; activating a model version requires approval (E04) and is logged (E14).

#### CHG-029 · Change authority matrix and approval policies
- **name_fa:** ماتریس مرجع تصویب و سیاست‌های تأیید تغییر
- **group:** Authorization and CAB
- **description:** Data-driven authority rules. Inputs (model, type, risk, impact, service criticality, cost, company/unit, CI class, team success score, pipeline evidence, late flag) feed ordered decisions that produce approval definitions: automation/auto-approve, peer reviewer, team lead, change manager, service owner, CAB, ECAB, business owner, security, finance. Execution is first-match or run-all-matching, and later decisions can depend on earlier outcomes. The output is an approval plan (sequential and/or parallel groups) snapshotted on the change, e.g. Low → auto-approve; Moderate → peer + change manager; High/Very High → CAB. A visual view shows the resolved approval workflow.
- **sources:** ITIL 4 (change authority, decentralized authority); SN (Change Approval Policies on decision tables); ISO/IEC 20000-1; Halo (approval rules branching on risk score); SolarWinds (precision approvals, approval workflow visualization); access.md (authority matrix as data)
- **tier:** P0 · **ai:** no
- **implementation:** E03 decision table `change_approval_policy` → E04 approval plan (`approval_plan_snapshot jsonb`); re-planned on re-authorization; plan visualizer in E16.

#### CHG-030 · Dynamic approver resolution
- **name_fa:** تعیین پویای تأییدکنندگان
- **group:** Authorization and CAB
- **description:** Approver sources: assignment-group manager, change manager, a named CAB, change approvers of the affected services, CI owners and support groups, service owner, requester's manager or department head (org-tree depth n), unit head, role-in-context (e.g. change manager for the affected service subtree), a per-change user-picker field, a group or a script. Exclusion rules remove the requester or implementer; an empty result escalates to the next authority level.
- **sources:** JSM (approver sources incl. affected services, exclude approvers); FS (department heads, reporting managers, agent groups, CAB members); SN; access.md
- **tier:** P0 · **ai:** no
- **implementation:** E04 resolver plugins evaluated when approvals are requested; the resolved list is frozen per approval for audit.

#### CHG-031 · Approval rules, groups, chains and thresholds
- **name_fa:** قواعد، گروه‌ها و زنجیره‌های تأیید
- **group:** Authorization and CAB
- **description:** Each approval group has a rule: everyone, anyone, majority, first responder, a count or a percentage, with per-step approve and reject thresholds (a group rejects as soon as any step reaches its rejection threshold). Multi-level and parallel groups are combined by a chain rule; each stage has a closure rule ("all approved" or "all completed"); comments are mandatory on rejection (optional on approval); completion time is captured. Approvers act from web, portal, mobile, e-mail and chat/messenger through signed action links with the change summary attached.
- **sources:** FS (approval groups and chains, Everyone/Anyone/Majority/First responder); Halo (parallel approval groups with thresholds); SDP (approval levels, closure rule, approval comments); JSM (number of approvers); SN
- **tier:** P0 · **ai:** no
- **implementation:** E04 `approval_group(rule, threshold, chain_rule, level)` and `approval(approver_id, status, delegate_id, remark, acted_via)`; signed links via E11.

#### CHG-032 · Separation of duties in change
- **name_fa:** تفکیک وظایف در تغییر
- **group:** Authorization and CAB
- **description:** Dynamic SoD: requester, opener, implementer and assignee cannot approve the same change; the author of a production deployment cannot approve it. Modes block / warn / require a second approver per tenant policy; if the only eligible approver is conflicted the request escalates up the authority matrix instead of being self-approved. Static SoD between change-manager and auditor roles.
- **sources:** access.md (SoD engine); SOC 2 CC8.1; ISO/IEC 27001; SN and BMC (requester exclusion in approval engines)
- **tier:** P0 · **ai:** no
- **implementation:** E13 `sod_rule(kind=dynamic, left=requester|implementer|assignee|author, right=approver, mode)` checked by E04 at resolution and at vote time.

#### CHG-033 · Approval delegation, e-signature and step-up
- **name_fa:** تفویض تأیید، امضای الکترونیک و احراز هویت مرحله‌بالاتر
- **group:** Authorization and CAB
- **description:** Out-of-office delegation with a date range and conditions (e.g. only standard or low-risk changes), one active delegation per user, the delegate recorded on the approval; work delegation grants no standing access (only a temporary share). High-risk approvals and emergency authorizations can require an e-signature (re-authentication with a reason) and step-up MFA within a recent window; all decisions go to the privileged-action log.
- **sources:** FS (approval delegation, API since Jan 2026); SN (granular delegation, e-signature); access.md (step-up, JIT elevation)
- **tier:** P0 · **ai:** no
- **implementation:** E04 plus E13 `delegation` and a step-up policy per action class; hash-chained log in E14.

#### CHG-034 · Evidence-based auto-approval (streamlined change approval)
- **name_fa:** تأیید خودکار مبتنی بر شواهد
- **group:** Authorization and CAB
- **description:** Approval policies approve a change automatically when deterministic evidence satisfies policy: standard or low-risk model, all tests passed, peer review in version control, no critical vulnerabilities, linked work items approved, team success score above threshold, window open, no freeze, lockdown or exhausted error budget. Otherwise the change routes to people or CAB. The evidence snapshot and the rule version that approved it are stored as a "change receipt" so auditors can replay the decision. AI can never auto-approve.
- **sources:** DORA research (streamlined change approval); ITIL 4 HVIT; SN (DevOps change acceleration); JSM ("low-risk change in review → approved" flow); BMC
- **tier:** P1 · **ai:** no
- **implementation:** E03 policy over `change_evidence` (DEV-009); decision logged with `rule_version` and `inputs_hash` (E14).

#### CHG-035 · Error-budget and reliability gate
- **name_fa:** دروازه بودجه خطا و پایداری
- **group:** Authorization and CAB
- **description:** When an affected service's SLO error budget is exhausted over the policy window (or its burn rate is above a threshold), non-exempt changes to that service are blocked or routed to a higher authority. P0 bug fixes, security fixes and emergency changes are exempt. The gate status shows in the risk panel and in pipeline gate responses.
- **sources:** Google SRE Workbook (error-budget policy); standards.md (error-budget gate); ITIL 4 HVIT
- **tier:** P1 · **ai:** no
- **implementation:** Reads SLO and error-budget status from `slm` (API or materialized view); E03 gate condition on transitions to Authorize/Implement; exemptions by change category.

#### CHG-036 · CAB definitions and membership
- **name_fa:** تعریف هیئت مشورتی تغییر (CAB) و اعضا
- **group:** Authorization and CAB
- **description:** Named CABs (change, emergency, security, network, per business unit; a SIAM integrated CAB with provider representatives) with CAB manager, members (agents and non-agents such as business owners), delegates, recurrence (e.g. every Sunday 10:00 Tehran time), agenda conditions that pull in changes, minutes per agenda item, quorum and voting rules. CAB members get temporary read access to the changes on their agenda (participant share) instead of a broad change-read role.
- **sources:** SN (CAB definitions); FS (CABs, CRUD API); SDP (CABs of technicians and requesters); SIAM BoK (integrated CAB); access.md (CAB share)
- **tier:** P0 · **ai:** no
- **implementation:** `cab`, `cab_member`; recurrence via E06; agenda condition via E03; `share(reason=cab, expires_at = meeting end + N days)` via E13.

#### CHG-037 · CAB workbench and approver console
- **name_fa:** میز کار CAB و کنسول تأییدکننده
- **group:** Authorization and CAB
- **description:** Meeting mode: agenda built automatically from changes awaiting CAB (ordered by risk and start date), attendees and attendance, conference link, a "current item" spotlight with risk panel, conflicts and plans, live decisions (approve, reject, defer, request information) recorded as approvals, notes and action items, review of recently implemented and failed changes, and at the end editable minutes e-mailed and archived. Console mode for asynchronous review: a filtered list (status, priority, risk level, change manager, impact, urgency), detail tabs (details, work log, risk, validation) and approve / hold / reject with a rationale by primary or alternate approvers. Meetings are scheduled from the change calendar and invites sync to Outlook/Google.
- **sources:** SN (CAB Workbench in SOW, review of implemented changes); FS (CAB Huddle, Run meeting, e-mailed summary); BMC (CAB Workspace); ITIL 4 (CAB management)
- **tier:** P0 · **ai:** no
- **implementation:** `cab_meeting` (prefix CABM), `cab_agenda_item`; decisions written through E04; workbench UI in E16; minutes rendered by E23 (RTL PDF); invites via E06 calendar sync.

#### CHG-038 · Asynchronous (virtual) CAB voting
- **name_fa:** رأی‌گیری غیرهم‌زمان (مجازی) CAB
- **group:** Authorization and CAB
- **description:** For distributed teams each agenda item opens a voting window with a deadline; members vote approve / reject / abstain with comments from any channel; quorum and the decision rule (majority, unanimity, weighted) apply automatically at the deadline; no quorum escalates to the CAB manager; a discussion thread per item; results go into the minutes.
- **sources:** ITIL 4 (virtual CAB with asynchronous voting); FS (approvals from chat tools); access.md
- **tier:** P1 · **ai:** no
- **implementation:** Specialization of E04 groups with deadline timers (E10) and quorum evaluation; discussion via E25.

#### CHG-039 · AI CAB pack, readiness recommendation and minutes
- **name_fa:** بسته جلسه CAB، توصیه آمادگی و صورتجلسه با هوش مصنوعی
- **group:** Authorization and CAB
- **description:** Builds the CAB pack (one page per change: objective, plan, risk and its explanation, conflicts, blackout, validation gaps, submitter history); gives a readiness recommendation with evidence, gaps, needed resubmissions and a confidence statement; answers follow-up questions (validation, approvals, related CIs, conflicts, blackout windows); drafts minutes and action items from meeting notes or a transcript (Persian speech-to-text on a local model when enabled). It never records a decision.
- **sources:** BMC (CAB Supervisor / Change Approval Assistant with sub-agents); SN (summaries, agenda); ai.md (CAB support; no dedicated minutes generator found in the market)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skills `cab.pack` and `cab.minutes`; E18 Q&A agent with read tools; outputs saved as drafts on `cab_meeting`; approvals stay human (E04).

#### CHG-040 · Change SLAs, OLAs and approval timers
- **name_fa:** توافق سطح خدمت تغییر و زمان‌سنج‌های تأیید
- **group:** Authorization and CAB
- **description:** Timers on change processing: time to assess, time to approve (e.g. normal change ≤ 5 business days), time to schedule, implementation inside its window, PIR due date; per site or template; up to four escalation levels; reminders to approvers; pause on selected hold reasons; business calendars with Iranian holidays.
- **sources:** JSM ("Time to approve normal change" SLA, reminder automation); SDP (change SLAs with up to four resolution escalations); FS (approval reminders)
- **tier:** P0 · **ai:** no
- **implementation:** E10 SLA definitions targeting `change_request` and `approval`; calendars from E06; escalations via E09/E11.

#### CHG-041 · Change calendar (forward schedule of change)
- **name_fa:** تقویم تغییرات (برنامه زمانی پیش‌رو)
- **group:** Scheduling and conflicts
- **description:** Day, week, month, multi-day and timeline/Gantt views by service, CI, location, team and assignee; Jalali by default with a Gregorian toggle; maintenance windows shaded, blackout/freeze windows hatched (pattern, not colour only), information schedules and holidays; conflict badges and outlines; hover preview; drag-and-drop rescheduling that re-runs validation; filters on any field, CI/asset, affected service and keys with shareable URLs and saved views; default view per workspace; overlays for releases, deployments, CI outages, business events, on-call and CAB meetings; create a change from a slot; planned vs actual dates. Virtualized rendering for thousands of events.
- **sources:** ITIL 4 (change schedule); ISO/IEC 20000-1; SN (Change Schedule in Core UI and SOW); JSM (cross-space change calendar, filter builder, event-type filter); FS (Work Calendar); BMC (FSC book views, overlays, drag-and-drop); SDP (change calendar and scheduler); analytics_ux (calendar UX)
- **tier:** P0 · **ai:** no
- **implementation:** E16 calendar component over the E06 expansion API (server-side expansion per visible range); pluggable event sources (changes, releases, deployments, outages, windows, holidays, meetings); rescheduling goes through the normal write path.

#### CHG-042 · Calendar sharing and external calendar sync
- **name_fa:** اشتراک تقویم و همگام‌سازی با تقویم‌های بیرونی
- **group:** Scheduling and conflicts
- **description:** An iCal feed of any saved calendar filter with a signed, revocable token (readable by staff without agent access), windows included as events; two-way invite sync with Exchange/Outlook, Google and CalDAV for CAB meetings and implementation slots; a published forward-schedule page for the service desk and stakeholders that respects record visibility.
- **sources:** JSM (iCal subscription shareable with unlicensed people); SDP (change schedules synced to Office 365); FS (CAB Huddle O365/Google sync)
- **tier:** P1 · **ai:** no
- **implementation:** E06 feed endpoints with a token bound to a saved filter evaluated as the token owner (E13); connectors in E12 for Exchange, Google and CalDAV.

#### CHG-043 · Maintenance windows
- **name_fa:** پنجره‌های نگهداری
- **group:** Scheduling and conflicts
- **description:** Named recurring windows (daily, weekly, monthly with an end; time zone; exclusions; Jalali recurrences such as "every Thursday night" or "last Friday of each Jalali month") with conditions that define which changes, CIs or services may use them; associating a window sets planned dates; CI-level maintenance schedules; changes outside their CI's window are flagged; maintenance can be published to the status page; alerts for CIs inside an active window are suppressed; windows are manageable by API.
- **sources:** SN (maintenance schedules, outside-maintenance-window conflict); FS (maintenance windows with conditions, alert suppression, API Nov 2026); JSM (change windows); SDP (maintenance windows); BMC
- **tier:** P0 · **ai:** no
- **implementation:** `schedule_window(kind=maintenance, rrule, tz, exclusions, scope_condition, owner_group_id)` on E06; association validation via E03; suppression contract with the event module.

#### CHG-044 · Blackout and freeze windows
- **name_fa:** پنجره‌های ممنوعیت و انجماد تغییر
- **group:** Scheduling and conflicts
- **description:** Windows where changes must not happen (year-end, Nowruz, Jalali fiscal-year closing, elections, peak sales) scoped to all changes, sites, services, CI types or a condition; enforcement warn or block per window; recurring or one-off; holiday templates; the overlapping blackout is shown read-only on the change; overrides only for emergency changes or through a time-boxed elevated role with reason and audit; freezes apply to releases too (release "frozen until").
- **sources:** SN (blackout schedules); FS (blackout windows, freeze toggle, read-only blackout field); SDP (freeze windows scoped to sites/services, release frozen until freeze ends); JSM (freeze windows); ISO/IEC 20000-1; access.md (elevated override)
- **tier:** P0 · **ai:** no
- **implementation:** `schedule_window(kind=blackout|freeze, enforcement)` on E06; checked by E03 gates and the conflict worker; override = E13 just-in-time elevation plus an E14 log entry.

#### CHG-045 · Conflict (collision) detection
- **name_fa:** تشخیص تداخل و برخورد تغییرات
- **group:** Scheduling and conflicts
- **description:** Detects: same CI scheduled in overlapping windows; parent/child and dependent CIs within N hops (indirect collisions through impact relationships); CI outside its maintenance window; inside a blackout; assignee or implementer double-booked; inside an active lockdown; shared resources; release-manifest collisions. Runs on save of CIs, dates or state, manually ("check conflicts") and on a schedule; results are listed by type with the other record and window. Each conflict has a status Detected / Investigating / Ignored / Resolved with mandatory justification for Ignored and Resolved, an audit trail, bulk status update and a chat with the other change's coordinator; statuses survive recomputation when a window reverts; per-change "exclude from conflict detection" flag and a cap per conflict type.
- **sources:** ITIL 4; ISO/IEC 20000-1; SN (conflict types, Conflict Detection flow and worker, max count, exclusion); BMC (collision statuses with justification, indirect collisions, audit trail, coordinator chat); JSM (conflicts in risk insights); FS; SDP (include overlapping changes)
- **tier:** P0 · **ai:** no
- **implementation:** E08 async worker per change; interval-overlap index (E06) over the CI set plus E07 n-hop neighbours; `change_conflict(change_id, other_type, other_id, ci_id, kind, window, status, justification, key_hash)`; status preserved by key (pair, CI, window).

#### CHG-046 · Change lockdown
- **name_fa:** قفل اضطراری تغییرات
- **group:** Scheduling and conflicts
- **description:** During a major incident or crisis a lockdown pauses all, or a filtered subset, of in-flight changes (by service, CI, location or condition): matching changes go on hold with reason "Lockdown", new changes in scope are blocked except emergency fixes, and conflict detection reports "inside lockdown". Releasing the lockdown restores previous states. A lockdown can be started from a major incident.
- **sources:** SN Brazil (Change lockdown with the Collision Detector)
- **tier:** P1 · **ai:** no
- **implementation:** `change_lockdown` (prefix LCK; window, scope condition, reason, started_by, major incident link); E09 flow to hold and restore with the saved prior state; E03 gate.

#### CHG-047 · Scaled change (parent with generated child changes)
- **name_fa:** تغییر مقیاس‌پذیر (والد با تغییرات فرزند)
- **group:** Scheduling and conflicts
- **description:** One parent change generates and coordinates child changes per CI or CI batch (e.g. patching 500 servers), each with its own schedule inside its CI's maintenance window, its own conflicts and approvals (or inherited approval when policy allows); plans are inherited; wave and stagger settings; parent progress rolls up; parent–child closure rules.
- **sources:** SN Brazil (Scaled change); SDP (parent–child changes with closure rules and workflow checks, 2026)
- **tier:** P1 · **ai:** no
- **implementation:** Generator job (E08) creating `change_request(parent_id)` rows in batches with continuation for large sets; wave planner over E06 windows; roll-up fields.

#### CHG-048 · Recurring scheduled changes
- **name_fa:** تغییرات دوره‌ای زمان‌بندی‌شده
- **group:** Scheduling and conflicts
- **description:** Periodic generation of changes (once, daily, weekly, monthly, Jalali-month based) from a template with roles, CIs and plans, typically standard changes for patch cycles, backups or certificate rotation; calendar and reports filter "changes from maintenance plans".
- **sources:** SDP (Change maintenance: periodic change creation, maintenance roles, reports)
- **tier:** P1 · **ai:** no
- **implementation:** `recurring_change_plan(template_id, rrule, next_run_at)`; E08 generator; `record_link(kind=generated_from)`.

#### CHG-049 · AI scheduling assistant
- **name_fa:** دستیار هوشمند زمان‌بندی تغییر
- **group:** Scheduling and conflicts
- **description:** Proposes the best windows for a change: inside CI maintenance windows, outside blackouts and holidays, free of conflicts, with implementers available (on-call and leave calendars), at low business traffic (from monitoring or usage history) and with enough lead time; explains the trade-offs and answers "assess conflicts" questions in natural language.
- **sources:** SN (Schedule a change and Assess conflicts agentic skills)
- **tier:** P1 · **ai:** yes
- **implementation:** Deterministic candidate generation (E06 plus the conflict worker) ranked by a scoring function; an E17 skill narrates; the user applies the chosen slot as a proposal write.

#### CHG-050 · Implementation tracking and realization control
- **name_fa:** پایش اجرا و کنترل تحقق تغییر
- **group:** Implementation and review
- **description:** At Implement: actual start/end captured manually or from deployment events, task progress against the plan, implementer checklist or runbook steps with timestamps, a "change in progress" banner on affected CIs and services and in the service desk (so incidents during the window can be linked), overrun warnings before the window ends, implementation status reasons (in rollout, in test, in rollback, in verification), and a performance rating of the implementation at completion.
- **sources:** ITIL 4 (realization control); BMC (actual dates, Performance Rating); JSM (actual dates filled from deployments); SDP
- **tier:** P0 · **ai:** no
- **implementation:** E09 flows on state Implement; E10 timer for the window end; banner via a record-context API used by the incident form; runbook steps as `change_task` checklists that also work offline in the Windows replica (E22) and sync timestamps later.

#### CHG-051 · Backout and remediation
- **name_fa:** بازگشت (Backout) و اصلاح
- **group:** Implementation and review
- **description:** The remediation/backout plan must exist (and be marked tested with evidence where policy requires) before authorization. On failure the implementer triggers backout (status "In rollback"), records the steps and the outcome; unsuccessful changes are reversed or remediated and the outcome is recorded; a remediation change can be raised and linked; if configured, failure opens an incident or problem automatically.
- **sources:** ISO/IEC 20000-1 §8.5.1.3 (remediation planned and tested); PCI DSS 6.5.1 (backout procedures); BMC (In Rollback); SDP (On hold/Backout); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** Fields `backout_plan`, `backout_tested`, `backout_evidence`; a "backout" transition in seed models; E09 flow to create the incident or problem.

#### CHG-052 · Closure codes and outcome capture
- **name_fa:** کدهای بستن و ثبت نتیجه تغییر
- **group:** Implementation and review
- **description:** Close code (Successful, Successful with issues, Unsuccessful, Backed out, Cancelled, Automatically cancelled), mandatory close notes, requester confirmation of success in Review, actual vs planned duration, number of incidents caused, lessons learned. The outcome drives KPIs, success scores and ML labels.
- **sources:** SN (close codes, Review by requester); BMC (Closed status reasons); SDP (mandatory closure codes); ISO/IEC 20000-1; ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** `close_code` reference plus the E02 Review gate; outcome fields indexed for E15 and as E20 labels.

#### CHG-053 · Post-implementation review (PIR)
- **name_fa:** بازبینی پس از اجرا (PIR)
- **group:** Implementation and review
- **description:** A light effectiveness confirmation for every change and a full PIR, mandatory by policy, for failed, backed-out, emergency, major and high-risk changes: objectives met, side effects, incidents caused, plan accuracy, timeline, what went well or badly, lessons learned, follow-up actions. PIRs are reviewed in CAB; outcomes feed the improvement register, standard-change candidacy and success scores. AI drafts the PIR from the timeline, work notes, incidents and deployment data.
- **sources:** ITIL 4; ISO/IEC 20000-1; COBIT BAI06.04, BAI07.08; SN (review of implemented changes in CAB, Zurich); FS (PIR widget with AI)
- **tier:** P0 · **ai:** yes
- **implementation:** `change_pir` (1:1 with change; checklist, ratings, actions as tasks); a policy rule sets `pir_required`; E17 skill `change.pir_draft`; actions flow to the improvement register.

#### CHG-054 · Change-caused incidents and change timeline on CIs
- **name_fa:** حوادث ناشی از تغییر و خط زمانی تغییرات روی پیکربندی‌ها
- **group:** Implementation and review
- **description:** Incidents can be linked as "caused by change"; incidents opened on affected CIs during or shortly after the window are flagged for review; every CI and service shows a timeline of recent changes, deployments and configuration changes for incident and problem investigation; the change shows "incidents caused" with a count; attribution feeds change failure rate and success scores.
- **sources:** ITIL 4 (schedule used after deployment by incident and problem management); SN; JSM (incident investigation view); FS (initiating changes); BMC (AIOps change correlation window); analytics_ux (caused_by_change)
- **tier:** P0 · **ai:** no
- **implementation:** `record_link(kind=caused_by)`; a CI-timeline API joining changes, deployments (DEV) and CMDB history; an E09 rule flags incidents within window + N hours on affected CIs.

#### CHG-055 · Suspect-change finder for incidents
- **name_fa:** یافتن تغییرهای مظنون برای حوادث
- **group:** Implementation and review
- **description:** From an incident or major incident, ranks the likely causing changes: change requests closed in the last 14 days (configurable), code deployments, commits and pull requests, feature-flag toggles and infrastructure or configuration changes in the affected CI's dependency neighbourhood between the last stable and the disrupted state. Evidence is shown (same CI, time proximity, text similarity, failure history); one click links "caused by" and marks a "potential cause".
- **sources:** FS (Find Initiating Changes, 14 days); JSM (incident investigation view, mark potential cause); BigPanda (root-cause changes); ITIL 4 HVIT (suspect commits); BMC (AIOps change correlation)
- **tier:** P1 · **ai:** yes
- **implementation:** Candidates from the CI timeline (CHG-054) and DevOps data within the E07 neighbourhood; ranking by an E20 model or heuristic with E19 similarity; E17 explanation; linking is a confirmed write.

#### CHG-056 · Unauthorized change detection
- **name_fa:** تشخیص تغییرات غیرمجاز
- **group:** Implementation and review
- **description:** Reconciles configuration changes detected by discovery, drift detection, IaC drift or file-integrity monitoring against authorized changes (CI in scope and inside the implementation window). Mismatches create an audit finding, a retrospective change, an incident or a security event per policy; a dashboard shows unauthorized changes by team and CI.
- **sources:** ITIL 4 (configuration control); COBIT BAI10.05; ISO/IEC 27001 A.8.9; NIST CSF ID.RA-07; analytics_ux (unauthorized change count)
- **tier:** P1 · **ai:** no
- **implementation:** E08 job consuming CMDB change history and drift events (DEV-014); match rules in E03; outcomes via E09; metric in E15.

#### CHG-057 · Change trend reviews at planned intervals
- **name_fa:** بازبینی دوره‌ای روند تغییرات
- **group:** Implementation and review
- **description:** Scheduled reviews (e.g. monthly) create a review task with a pre-filled report: success and failure rates, emergency share, backlog and ageing, approval cycle time, changes causing incidents, unauthorized changes, conflicts, PIR completion and standard-change usage. Reviewers record findings and improvement actions; the evidence is kept for ISO/IEC 20000 audits.
- **sources:** ISO/IEC 20000-1 (change records analysed at planned intervals to detect trends); COBIT BAI06.03; ITIL 4 (practice optimization)
- **tier:** P0 · **ai:** no
- **implementation:** The planned-interval engine (E08) creates a `review_task` with an E15 snapshot attached (E23 PDF); findings link to the improvement register.

#### CHG-058 · Regulated change controls and audit evidence
- **name_fa:** کنترل‌های انطباقی تغییر و شواهد ممیزی
- **group:** Implementation and review
- **description:** A control library maps change fields and gates to requirements: ISO/IEC 27001 A.8.32 (change management), A.8.31 (separation of environments), A.8.29 (security testing), A.8.19 (software installation); SOC 2 CC8.1; PCI DSS 6.5.1–6.5.2 (security impact, re-confirmation after significant change); EU DORA Art. 9(4)(e); local regulators' requirements as loadable libraries. Conditional compliance field groups appear by scope (e.g. payment systems); each change carries evidence links; auditors export the complete population of changes for a period, with approvals and test evidence, for sampling.
- **sources:** standards.md (ISO/IEC 27001, SOC 2, PCI DSS 4.0.1, EU DORA); SN Brazil (compliance dynamic schema)
- **tier:** P1 · **ai:** no
- **implementation:** E14 requirement/control library with crosswalks; conditional field groups via E02 policies; population export job (E08) with read audit.

#### CHG-059 · Stakeholder communications and status page
- **name_fa:** اطلاع‌رسانی به ذی‌نفعان و صفحه وضعیت
- **group:** Communication, collaboration and integration
- **description:** A communication plan per change (audience, channel, timing: before, at start, at completion, on failure) generated from the impacted services and their stakeholder groups; Persian templates; channels: e-mail, a portal banner on affected services, the status page (scheduled maintenance with timeline), SMS, Bale/Eitaa/Telegram/Rubika channels, Teams/Slack; a service-desk briefing on what is changing today; publication of planned deployment dates.
- **sources:** ITIL 4 (service desk owns the channel; content from change and release); ISO/IEC 20000-1 (deployment dates communicated); FS (status page scheduled maintenance); SDP (planned downtime announcements); JSM (stakeholders on services)
- **tier:** P0 · **ai:** no
- **implementation:** `comm_plan_item` children; scheduled multi-channel sends via E11; status-page integration; stakeholder resolution from service records (E07).

#### CHG-060 · Process notifications
- **name_fa:** اعلان‌های فرایندی تغییر
- **group:** Communication, collaboration and integration
- **description:** Notifications to participants on: submitted, assigned, approval requested / reminder / decided, scheduled (requester informed), conflict detected, window starting or ending, implementation failed, backout started, PIR due, closed. Per-user channel preferences; actionable notifications (approve/reject, acknowledge a conflict) through signed links; push notifications on mobile and in the Windows app.
- **sources:** SN (requester e-mailed at Scheduled); FS; SDP (push notifications for change approvals); JSM; BMC
- **tier:** P0 · **ai:** no
- **implementation:** E11 event-to-template mapping per model; signed action tokens; digest options.

#### CHG-061 · Change workspace, list and kanban views
- **name_fa:** میز کار تغییر، فهرست‌ها و کانبان
- **group:** Communication, collaboration and integration
- **description:** Agent workspace with predefined views (my changes, awaiting my approval, implementing today, open conflicts, overdue PIR), advanced filters and saved views, list / calendar / kanban-by-state toggle, form with lifecycle bar, side panels (risk insights, conflicts, impacted services, related records, development, AI), activity stream with work notes and public comments, print/PDF with tasks, keyboard navigation, 400% reflow and screen-reader support.
- **sources:** SN (Service Operations Workspace, 400% reflow of the create page); FS (views, list/calendar toggle); SDP (print preview with tasks); BMC
- **tier:** P0 · **ai:** no
- **implementation:** E16 generic list, form and kanban bound to change metadata; side-panel registry; E23 for print.

#### CHG-062 · Collaboration and swarming on changes
- **name_fa:** همکاری و هم‌اندیشی گروهی روی تغییرات
- **group:** Communication, collaboration and integration
- **description:** Conversations on the change (internal and public notes, reply-all), @mentions, a swarm room that brings together the coordinators of conflicting changes, subject-matter experts and CAB members, and a chat bridge to Bale, Teams or Slack with messages synced back; chat logs are saved to the work log.
- **sources:** BMC (intelligent swarming for change; chat with other coordinators on collisions saved to Work Details); SDP (Reply All in change conversations); FS (notes)
- **tier:** P1 · **ai:** no
- **implementation:** E25 threads bound to records; external bridges via E12; transcripts stored as work notes.

#### CHG-063 · Change flows and business rules
- **name_fa:** جریان‌کار و قواعد کسب‌وکار تغییر
- **group:** Communication, collaboration and integration
- **description:** Visual flows per model (approvals, notifications, field updates, conditions, switches, timers, tasks, webhooks, custom functions) with default flows for Normal, Emergency and Standard; business rules on create and update; triggers on approval required/completed, deployment events, conflicts and SLA thresholds; flow execution status visible on the record; AI can draft a flow from a description.
- **sources:** SN (change flows in Workflow Studio replacing legacy workflows); SDP (visual change workflow, Workflow Assist); JSM (automation triggers incl. approval and deployment events); FS (Workflow Automator)
- **tier:** P0 · **ai:** no
- **implementation:** E09 with change-specific actions (create task, request approval plan, run conflict check, compute risk, set on hold); execution log on the record.

#### CHG-064 · Change API and webhooks
- **name_fa:** رابط برنامه‌نویسی و وب‌هوک تغییر
- **group:** Communication, collaboration and integration
- **description:** REST API to create normal, standard and emergency changes (by model or template), update and transition them, add tasks, notes and attachments, compute risk, refresh impacted services, get and refresh conflicts, and manage approvals, CABs and windows; filtering, sorting and pagination; outbound webhooks on change events. Used by pipelines, external tools and the MCP server.
- **sources:** SN (Change Management REST API, ChangeRequest API); FS (Changes, CAB and Maintenance Windows APIs); BMC (REST from pipelines); SDP
- **tier:** P0 · **ai:** no
- **implementation:** Generated from metadata (E01) plus domain endpoints; machine identities and scopes (E13); webhooks via E12.

#### CHG-065 · External change sync and SIAM e-bonding
- **name_fa:** همگام‌سازی تغییر با سامانه‌های بیرونی و تأمین‌کنندگان
- **group:** Communication, collaboration and integration
- **description:** Bi-directional exchange of change records with suppliers, customers and other tools (another ITSM, Jira, Azure DevOps): field and state mapping, correlation IDs (local and remote numbers), acknowledgement and retry, field-ownership rules, attachment and work-log sync, approval relay; provider changes are visible in the integrated CAB and on the calendar.
- **sources:** ITIL 4 / SIAM (e-bonding); SIAM BoK (integrated CAB); BMC (Azure DevOps ↔ change sync via Multi-Cloud Broker); SDP (Azure DevOps, Jira links)
- **tier:** P1 · **ai:** no
- **implementation:** E12 sync connectors with mapping tables and conflict rules; `external_ref` on the change.

#### CHG-066 · Change roles, transition rights and option rules
- **name_fa:** نقش‌ها، حقوق گذار و قواعد گزینه در تغییر
- **group:** Access and administration
- **description:** Roles: change requester, change owner/coordinator, change manager, implementer, approver, CAB member, CAB manager, reviewer, UAT owner, change viewer and change admin (configuration of models, risk, windows); custom roles with stage-wise view/edit/approve permissions; roles granted in a context (e.g. change manager for one service or org subtree); transition rights (only CAB or change manager can move to Scheduled; only the implementer group can start Implement); option rules (only CAB members may set risk Very High; Emergency type only for on-call managers).
- **sources:** SDP (change roles, stage-wise permissions); BMC (functional roles, Change Master/User/Viewer/Config); SN (change_manager, cab_manager, sn_change_admin); iTop (lifecycle stimuli rights); GLPI (lifecycle matrix); RT (rights per transition); Znuny (option ACLs); access.md
- **tier:** P0 · **ai:** no
- **implementation:** E13 role-in-context; `transition_rule` and `option_rule` on `change_request`; seed role bundles.

#### CHG-067 · Change visibility scoping and restricted changes
- **name_fa:** دامنه دسترسی به تغییرات و تغییرات محرمانه
- **group:** Access and administration
- **description:** Who sees a change derives from requester/requested-for, coordinator, implementer and manager groups, assignee, service ownership, org unit, company, location, project, CAB agenda shares and open approvals. Security-sensitive changes (firewall, IAM, patches for undisclosed vulnerabilities) can be restricted by security level or restricted group. Development data on the change needs the "view development tools" permission.
- **sources:** BMC (visibility from requester and group relationships written to a row-level field); access.md (scopes, restrictions, shares); JSM (view development tools permission)
- **tier:** P0 · **ai:** no
- **implementation:** `acl_keys` computed by E13 from the access-scoping fields in the Data model; restriction flags; field class `dev` for DevOps panels.

#### CHG-068 · AI change summary
- **name_fa:** خلاصه‌سازی هوشمند تغییر
- **group:** AI assistance
- **description:** State-aware, sectioned summary in Persian: objective, plan, risk, affected CIs and impacted services (from Assess on), close notes and incidents caused (at Closed). One click for approvers, CAB, hand-offs and managers; regenerated after significant updates; English on request.
- **sources:** SN (change request summarization with sections required by state); BMC; JSM (Prevention Center change summary)
- **tier:** P0 · **ai:** yes
- **implementation:** E17 skill `change.summary` with a state → sections configuration; output cached per record version and viewer ACL fingerprint.

#### CHG-069 · AI drafting of plans and justification
- **name_fa:** پیش‌نویس هوشمند برنامه‌ها و توجیه تغییر
- **group:** AI assistance
- **description:** Drafts implementation, backout, test and communication plans, risk and impact analysis and business justification from the description, affected CIs, standard templates, CI runbooks and similar successful changes; generates test cases. The user edits before saving; drafts are labelled as AI-generated.
- **sources:** SN (Generate change request plans and schedule); FS (Test Case Generator); ITIL v5 (AI drafting in transition); ai.md
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skill `change.plan_draft` with E19 retrieval of similar successful changes and runbooks; proposal-only write.

#### CHG-070 · AI change quality and readiness validation
- **name_fa:** اعتبارسنجی هوشمند کیفیت و آمادگی تغییر
- **group:** AI assistance
- **description:** Runs automatically when a change reaches a configured state (e.g. before Authorize) and on demand. Checks readiness (service and CIs present, window chosen, justification, outcome and benefits) and documentation quality (plans in fields and attached DOCX/PDF/TXT judged for clarity, specificity and verifiability). Result: Complete / Incomplete change / Incomplete documentation / both / Error, plus a quality score stored per change; findings posted as an activity note and a banner; advisory only.
- **sources:** BMC (Change Coordinator agent: validation statuses, weighted risk parameters); SN (Change Quality Assessor, quality scores stored per change)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 rubric skill (0–5 per plan) plus deterministic checks (E03); stored in `change_ai_validation`; its score is the "plan quality" feature for CHG-023.

#### CHG-071 · Similar change suggester
- **name_fa:** پیشنهاد تغییرهای مشابه
- **group:** AI assistance
- **description:** Shows recent similar changes (by text, CI class, service and model) with their outcomes, plans and PIR lessons, with feedback buttons; used by requesters, the risk engines and CAB.
- **sources:** FS (Similar Change Suggester with feedback); SN (similar changes in risk explanation); ai.md
- **tier:** P1 · **ai:** yes
- **implementation:** E19 embeddings over change text plus structured filters; results ACL-filtered; feedback stored for tuning.

#### CHG-072 · Change copilot (conversational creation and assistance)
- **name_fa:** دستیار گفت‌وگومحور تغییر
- **group:** AI assistance
- **description:** A Persian conversational agent that creates a change by asking only for what is missing (type, CIs with suggestions, window, plans), proposes a model or a standard template, fills fields, runs risk and conflict checks and explains the results. On an existing change it answers questions (pending approvals, conflicts, blackout, submitter history, content of attachments) and logs its actions to work notes. Available in the agent workspace, portal, Windows app and messenger bots.
- **sources:** SN (Change AI Specialist, conversational change agent, Suggest configuration items); BMC (Agent Assist for change requests; Service Collaborator reads attachments)
- **tier:** P1 · **ai:** yes
- **implementation:** E18 agent whose tools are change API operations (proposal writes that need confirmation); runs as the user; CI suggestions via E19.

#### CHG-073 · Reviewer and implementer recommendation
- **name_fa:** پیشنهاد بازبین و مجری مناسب
- **group:** AI assistance
- **description:** Suggests additional reviewers (e.g. add a DBA for database CIs) and the best implementer or group from the history of successful changes on similar CIs, skills and availability.
- **sources:** BMC (Change Risk Advisor suggests experts); SDP (Zia engineer prediction)
- **tier:** P2 · **ai:** yes
- **implementation:** Expertise vectors per person from completed changes (E19) plus skills and availability from `workforce`; proposal only.

#### CHG-074 · AI-led change configuration from policy documents
- **name_fa:** پیکربندی تغییر با هوش مصنوعی از روی اسناد خط‌مشی
- **group:** AI assistance
- **description:** Configuration agents read the organization's change policy documents (PDF, DOCX, XLSX, CSV; Persian or English) and propose forms, list views, team roles, risk questions and thresholds, CAB definitions, change models and maintenance/blackout schedules; the admin reviews a diff and publishes.
- **sources:** SN Simplified ITSM (change forms, roles, risk, CAB, models and schedule configuration agents)
- **tier:** P2 · **ai:** yes
- **implementation:** E18 admin agent producing drafts of E02/E03/E05/E06 configuration objects; publishing goes through the admin module's configuration promotion.

#### CHG-075 · Change reports and dashboards
- **name_fa:** گزارش‌ها و داشبوردهای تغییر
- **group:** Analytics
- **description:** Ready-made reports: changes by type, model and state; time to approve normal changes; success, failure and backout rates; changes causing incidents; emergency ratio; CAB throughput and decision time; backlog and ageing; lead time; conflicts and schedule compliance; standard-change usage; success-score dashboards. Drill-down to records, scheduled distribution, Jalali periods.
- **sources:** JSM (change reports, Insights change overview template, Data Lake change table); SN (Change Analytics dashboards); FS (Analytics); SDP; analytics_ux
- **tier:** P0 · **ai:** no
- **implementation:** E15 metric definitions (see KPIs) and a "Change management overview" dashboard template.

#### CHG-076 · Change process mining
- **name_fa:** فرایندکاوی تغییر
- **group:** Analytics
- **description:** Reconstructs actual change paths from state history to find bottlenecks (where approvals stall, rework loops back to New, skipped steps), compares models and teams, and simulates the effect of policy changes (e.g. auto-approving low risk).
- **sources:** SN (Process Mining on the platform); ITIL 4 (change practice optimization)
- **tier:** P2 · **ai:** no
- **implementation:** E15 event-log extraction from audit history; variant-analysis UI.

### Data model

**Record and configuration tables** (all records carry the standard secured-record columns: `tenant_id, domain_id, workspace_id, security_level_id, restricted_group_id, classification, company_id, org_unit_id, location_id, cost_center_id, service_id, acl_keys, acl_version`).

| Table | Prefix | Key fields |
|---|---|---|
| `change_request` | CHG | number, type, model_id, model_version_id, category, requester_id, requested_for_id, opened_by_id, owner_id (coordinator), change_manager_id, assignment_group_id, assignee_id, implementer_group_id, manager_group_id, service_id, offering_id, short_description, description, justification, expected_outcome, priority, impact, urgency, risk, risk_source, risk_override_reason, planned_start, planned_end, actual_start, actual_end, maintenance_window_id, outage_expected, implementation_plan, test_plan, backout_plan, backout_tested, comm_plan, planned_effort_h, planned_cost, cab_required, cab_meeting_id, conflict_status, conflict_last_run, on_hold, on_hold_reason, is_late, policy_version_id, std_template_version_id, parent_id, lockdown_id, project_id, close_code, close_notes, pir_required, origin_type, origin_id, external_ref, state, status_reason |
| `change_task` | CTASK | change_id, type, seq, depends_on[], task_group_id, assignment_group_id, assignee_id, planned/actual start-end, checklist, state |
| `change_affected_ci` / `change_impacted_service` | — | change_id, ci_id/service_id, role (primary/affected), computed path, weight, refreshed_at |
| `change_type`, `change_model`, `change_model_state`, `change_model_transition`, `state_field_policy`, `status_reason` | — | versioned model definitions (E02) |
| `change_policy` | — | version, scope conditions, category rules, lead-time rules, major-impact criteria, effective_from |
| `change_template` / `standard_change_template` / `standard_change_proposal` | CHGT / STD / STDP | model, version, prefilled fields, task templates, authoring group, owner, review date, stats |
| `change_risk_assessment`, `change_risk_policy`, `change_risk_profile`, `change_risk_result`, `risk_probability_lookup` | — | questionnaire answers; policy conditions; profile rules and weights; per-engine score, level, inputs_hash, explanation, model_version |
| `change_success_score` | — | group_id, model_id, day, score, band, components |
| `change_approval_policy` → `approval_plan`, `approval_group`, `approval` (shared E04) | — | decision rows; resolved plan snapshot; rule/threshold; approver, delegate, status, remark, channel |
| `cab`, `cab_member`, `cab_meeting`, `cab_agenda_item`, `cab_vote` | CABM (meeting) | recurrence, agenda condition, quorum; attendance, decisions, minutes |
| `schedule_window` (shared with release) | WIN | kind (maintenance/blackout/freeze/information), rrule, tz, exclusions, scope condition, enforcement |
| `ci_outage` (shared with cmdb/slm) | OUT | ci_id/service_id, type, start, end, source_change_id |
| `change_conflict` | — | change_id, other_type, other_id, ci_id, kind, window, status, justification, key_hash |
| `change_lockdown` | LCK | window, scope condition, reason, major_incident_id, state |
| `recurring_change_plan` | — | template_id, rrule, next_run_at |
| `change_pir` | — | change_id, checklist, ratings, lessons, actions |
| `change_evidence` (shared with devops) | — | change_id, hash, payload, rule_versions, decision |
| `change_ai_validation` | — | change_id, status, score, findings, model, run_id |
| `comm_plan_item` (shared with project) | — | parent record, audience, channel, timing, template, sent_at |

**States** (normal model; other models map to the same categories)

| State | Category | Notes |
|---|---|---|
| New | new | draft, no notifications |
| Assess | active | peer/technical review, risk, conflicts |
| Authorize | waiting | approval plan running |
| Scheduled | waiting | approved, waiting for planned start |
| Implement | active | tasks running, status reasons |
| Review | resolved | outcome, PIR; cannot be cancelled |
| Closed | closed | close code required |
| Canceled | canceled | from any state except Review/Closed |
| On hold (flag) | waiting | reason required; lockdown sets it |

**Relationships:** change 1–n change_task; change n–n CI and service; change n–1 model version; change n–n incident (initiated_by, caused_by); change n–n problem/known error (fixes); change n–n release (manifest); change n–1 project/project task; change n–n deployment, pipeline run, commit, PR; change 1–n conflict; change n–1 CAB meeting (agenda); change 1–1 PIR; change n–1 standard template version; change n–1 parent change; change n–1 lockdown.

**Access-scoping fields:** own = `requester_id`, `requested_for_id`, `opened_by_id`; assigned = `assignee_id` (and task assignees); group = `assignment_group_id`, `implementer_group_id`, `manager_group_id`; unit = `org_unit_id`; service = `service_id` plus impacted services (service-subtree keys); company/location/cost center = `company_id`, `location_id`, `cost_center_id`; project = `project_id`; participant = open approvers, CAB agenda shares, watchers; domain/workspace = `domain_id`, `workspace_id`; restrictions = `security_level_id`, `restricted_group_id`, `classification`. Change tasks inherit the parent's keys plus their own assignee and group.

### KPIs

| KPI | Formula | Target / note |
|---|---|---|
| Change success rate | changes closed Successful ÷ changes implemented (excluding cancelled) | ≥ 95% normal, ≥ 98–99% standard |
| Change failure rate | (failed + backed out + caused ≥ 1 incident) ÷ implemented | aligned with DORA change fail rate |
| Backout / rollback rate | backed out ÷ implemented | < 2–3% |
| Emergency change ratio | emergency ÷ total changes | < 5–10%; rising trend = weak planning |
| Standard change ratio | standard (pre-authorized) ÷ total; plus auto-approved pipeline changes ÷ total | mature organizations ≥ 50–70% |
| Change-caused incident rate | changes with ≥ 1 `caused_by` incident ÷ implemented; and incidents caused by change ÷ all incidents | < 2–5% |
| Unauthorized changes | detected configuration changes without an approved change (count and ÷ detected changes) | 0 |
| Change lead time | median(implemented_at − created_at) by type and model | trend down |
| Approval cycle time | median(authorized_at − submitted_for_approval_at); "time to approve normal change" SLA attainment | e.g. ≤ 5 business days |
| Schedule adherence | implemented inside planned window ÷ implemented | ≥ 95% |
| Schedule compliance violations | implemented outside maintenance window or inside blackout/freeze (count) | 0 |
| Late change rate | changes submitted with notice < policy lead time ÷ total | trend down |
| CAB load and speed | % of changes reviewed by CAB; changes per meeting; average decision time per agenda item; deferred decisions | CAB ≈ 5–15% of volume |
| PIR completion | PIRs completed ÷ PIRs required (failed, emergency, major) | 100% |
| Authorization backlog | count and age of changes in Assess/Authorize | — |
| Unresolved conflicts at approval | changes authorized with conflicts in Detected/Investigating ÷ authorized | 0 |
| Risk calibration | Brier score = mean((p_fail − outcome)²); failure rate per risk band | monotonic by band |
| Change success score | per group: weighted success components normalized to bands | trend up |
| Time-performance index | planned implementation duration ÷ actual duration | ≈ 1 |
| Compliance ratio | changes passing all policy checks and evidence requirements ÷ closed changes | 100% |
| Realization time per model | median(closed_at − authorized_at) per model | — |
| Stakeholder satisfaction with change | mean survey score after change (requester and business owner) | — |

### Beyond the market
- **Jalali-native schedule with Iranian holidays:** windows and recurrences in the Jalali calendar ("last Thursday of each month", "1–13 Farvardin"), Iranian official holidays including the shifting lunar dates (Tasua/Ashura, Eid al-Fitr, Ramadan working hours) as one-click blackout templates refreshed every year, Saturday-first weeks and Thursday/Friday weekends, Jalali fiscal-year closing freezes for finance and banking systems. No leading tool does this natively.
- **Approvals where Iranian staff actually are:** signed approve/reject links and CAB voting through Bale, Eitaa, Telegram and Rubika bots and SMS gateways, with OTP-based step-up for high-risk approvals and a full audit trail.
- **Persian AI end to end:** risk explanations, CAB packs, plan drafts, PIRs and CAB minutes in formal Persian, including Persian speech-to-text minutes on a local model; the tenant chooses a cloud or on-premises model, so no change data has to leave the country.
- **Explainable, calibrated risk:** deterministic engines, ML and LLM narrative side by side, with a public calibration report (Brier score, band reliability) — vendors show risk but not how well it predicts.
- **Offline Windows replica for implementers:** data-centre staff open the change, runbook steps, contacts and backout plan offline, tick steps with timestamps and sync later; the change calendar and freeze windows are available offline; approvals stay online-only by policy.
- **Regulator-ready evidence:** local control libraries (e.g. requirements of national security authorities or the Central Bank for banks) loaded as data next to ISO/IEC 27001 and 20000, with complete Jalali-period populations for auditors.
- **Lockdown that follows the incident:** a major incident can trigger a scoped lockdown automatically, and AI drafts the "what is frozen and why" message for stakeholders.
- **CAB minutes and action tracking in one place:** no market tool drafts CAB minutes; we generate them, link actions to records and track them to closure.

## Module: release — مدیریت انتشار و استقرار

Release management makes new and changed services and features available for use; deployment management moves components into live (and test) environments; service validation and testing proves they meet requirements (ITIL 4). Releases bundle changes, work items and deployments; readiness is checked by policies and decided at go/no-go; deployed and released are tracked separately.

### Features

#### REL-001 · Release record
- **name_fa:** رکورد انتشار
- **group:** Records and lifecycle
- **description:** Fields: number, name, version (semantic or calendar, e.g. 1405.02), type (major, minor, patch, emergency; renamable), release model/template, product, service or application CI, priority, release manager and coordinator, assignment group, department/company, scope (features, stories, fixes, problems and known errors fixed, changes, CIs), planned start/end, readiness target date, release window, actual (work) start/end, `deployed_at` and `released_at` (separate), build plan, test plan, deployment plan, rollback plan, training and communication items, release notes, known errors accepted, go/no-go decision, early-life-support window, outcome and lessons, state and status reason, workspace.
- **sources:** ITIL 4 (release); ISO/IEC 20000-1 §8.5.3; COBIT BAI07; IT4IT (Service Release, deploy vs release); FS (RLS record, build and test plans, work start/end); SDP; BMC; SN (Digital Product Release)
- **tier:** P0 · **ai:** no
- **implementation:** `release` (prefix REL) on E01/E02; dates and windows via E06; `deployed_at`/`released_at` maintained from deployments and feature flags.

#### REL-002 · Release and deployment policy
- **name_fa:** خط‌مشی انتشار و استقرار
- **group:** Records and lifecycle
- **description:** A versioned policy: release types and their criteria, cadence (e.g. monthly train, weekly patch), standard release windows, the emergency release procedure, environments that require approvals, mandatory readiness checks per type, early-life-support duration per type, and criteria for major releases that need a transition package (REL-032).
- **sources:** ISO/IEC 20000-1 §8.5.3 (release types and frequency defined); COBIT BAI07; ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** `release_policy` versioned configuration driving templates, gates and windows (E03/E06).

#### REL-003 · Release models and templates
- **name_fa:** مدل‌ها و الگوهای انتشار
- **group:** Records and lifecycle
- **description:** Reusable blueprints mapping phases/stages, tasks (with predefined assignments, descriptions and attachments), approvals, readiness policies and notifications to each phase; layouts and sections, closure rules and task trigger settings. Templates are copied when a release is created (snapshot); products can restrict which templates are allowed; flows can apply templates automatically; older releases can be migrated into templates.
- **sources:** SN DPR (release templates, product-level allowed templates, flow action to apply, RMv2 migration); SDP (release templates with layouts and closure rules); ITIL 4 (release models)
- **tier:** P0 · **ai:** no
- **implementation:** E24 templates plus E02 models: `release_template(version, phases[], tasks[], policies[])`.

#### REL-004 · Release lifecycle: stages, milestones and phases
- **name_fa:** چرخه عمر انتشار: مراحل، نقاط عطف و فازها
- **group:** Records and lifecycle
- **description:** Default lifecycle Draft → Planning → Build → Test → Readiness (go/no-go) → Deploying → Early life support → Review → Closed, with Cancelled and On hold/Frozen. Up to 9 configurable stages with statuses per stage (e.g. Submission, Planning, Development, Testing, Deployment, Training, Review, Close); milestones with approvals (Initiate, Planning, Build, Test, Deployment, Close); phases with their own planned dates and CIs; progress indicator; stage-move permissions; edits of passed stages only when allowed.
- **sources:** ITIL 4 / v3 heritage (release lifecycle); SDP (up to 9 stages, progress indicator); BMC (release milestones with approvals); SN DPR (phases/stages with dates and CIs per phase); FS (release statuses)
- **tier:** P0 · **ai:** no
- **implementation:** E02 two-level model (stage → status); `release_phase(release_id, seq, planned_start, planned_end, state, ci_scope)`.

#### REL-005 · Release tasks and activities
- **name_fa:** وظایف و فعالیت‌های انتشار
- **group:** Records and lifecycle
- **description:** Tasks per phase (build, test, documentation, training, deployment preparation, communication) with assignees, dependencies, reminders, work logs and time entries; approvals can use a release task as their source; a kanban board per release; tasks appear on the work calendar.
- **sources:** SN DPR (release tasks, task as approval source, Kanban); FS (tasks, time entries); SDP (tasks, reminders, worklogs); BMC (release activities)
- **tier:** P0 · **ai:** no
- **implementation:** `release_task` (prefix RTASK) on E01/E02; kanban in E16.

#### REL-006 · Release manifest and change bundling
- **name_fa:** مانیفست انتشار و تجمیع تغییرات
- **group:** Records and lifecycle
- **description:** A release bundles changes (many-to-many), release activities, deployments and packages in a manifest. Changes can be created from a release (the release's CIs are copied to the change's affected CIs) or a release can be raised from an existing change; release actions are available on change pages. Progress derives from manifest items (all closed → suggest Completed). The release window is the union of item windows, and collision detection runs on manifest CIs.
- **sources:** BMC (release manifest; collisions on manifest items); SN DPR (changes from a release with CIs added automatically; release actions on change pages); FS (associated changes); SDP (log release from change, multiple releases ↔ changes)
- **tier:** P0 · **ai:** no
- **implementation:** `release_manifest_item(release_id, item_type, item_id, phase_id)`; reuses the change conflict worker (CHG-045) with the manifest CI set.

#### REL-007 · Release trains, parent/sub-releases and dependencies
- **name_fa:** قطار انتشار، انتشارهای والد و فرزند و وابستگی‌ها
- **group:** Records and lifecycle
- **description:** Parent releases (programmes, release trains) with sub-releases per product; dependencies between releases form a DAG with cycle detection; Gantt-like dependency view; multi-product readiness roll-up; release-slot capacity per train.
- **sources:** SDP (parent/sub-releases with dependency views); ITIL 4 (release trains, dependency mapping, slot capacity); SN DPR (multi-product roll-up); SAFe (release trains)
- **tier:** P1 · **ai:** no
- **implementation:** `release.parent_id`, `release_dependency(from_id, to_id, type)`; schedule propagation via E21; roll-up fields.

#### REL-008 · Release calendar
- **name_fa:** تقویم انتشار
- **group:** Records and lifecycle
- **description:** Calendar of releases and readiness targets overlaid with the change schedule, deployments, freeze windows, weekends and holidays (Jalali, Iranian official holidays); product-level calendars; create a release from the calendar; frozen releases show "frozen until"; release slots.
- **sources:** SN DPR (release calendars with weekends and holidays, unified view with changes, product-level calendars); SDP (release scheduler, freeze handling); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** Same E16 calendar with release and readiness-target event sources; E06 windows and holidays.

#### REL-009 · Release roles, separation of duties and step-up
- **name_fa:** نقش‌های انتشار، تفکیک وظایف و احراز هویت مرحله‌بالاتر
- **group:** Records and lifecycle
- **description:** Roles: release requester, release manager, release coordinator, release engineer, approver, reviewer, release viewer and release admin (templates, calendars); custom roles. Build ≠ approve ≠ deploy: a production deployment needs approval by someone other than its author; approving or executing a production deployment requires recent MFA (step-up) and is written to the privileged-action log; record-level restricted visibility; assignee pick-lists filtered by role.
- **sources:** BMC (Release Master/User/Viewer/Config); SDP (release roles, SDReleaseManager); FS (Release Manager); SN (deployment permissions separate from build, modular roles, restricted visibility); access.md (author ≠ production approver, step-up)
- **tier:** P0 · **ai:** no
- **implementation:** E13 roles, `sod_rule` and step-up per action class; E14 privileged-action log.

#### REL-010 · Release flows and automation
- **name_fa:** جریان‌کار و خودکارسازی انتشار
- **group:** Records and lifecycle
- **description:** Graphical workflows with wait-for, task, timer, fork/join, IF (boolean functions), webhook, custom-function nodes and error paths; execution status in lists and details; triggers on version events from development tools (version created, released), task completion and policy failures.
- **sources:** SDP (release workflow nodes, execution status); SN (flows apply templates); JSM (version created/released automation triggers)
- **tier:** P0 · **ai:** no
- **implementation:** E09 with release-specific actions (run policies, create change from release, set frozen).

#### REL-011 · Release workspace and overview dashboard
- **name_fa:** میز کار و داشبورد نمای کلی انتشار
- **group:** Records and lifecycle
- **description:** One page per release: dates, readiness target, risk score, task states, changes, work items, policies and their results, approvals and deployments per environment; kanban boards; one-click navigation; table, classic and calendar views of releases with filters (my open, unassigned, completed, incomplete, deployed).
- **sources:** SN DPR (Release Overview dashboard, DPR Workspace); FS (release views); SDP (table/classic/calendar views, deployed-releases filter)
- **tier:** P0 · **ai:** no
- **implementation:** E16 composite workspace over release, manifest and deployment data.

#### REL-012 · Release API and webhooks
- **name_fa:** رابط برنامه‌نویسی و وب‌هوک انتشار
- **group:** Records and lifecycle
- **description:** REST API for releases, phases, tasks, manifest items, deployments, readiness policies (run on demand), notes and time entries; webhooks on release events; used by pipelines and development-tool connectors.
- **sources:** FS (Releases API); SN DPR (policies run through APIs)
- **tier:** P0 · **ai:** no
- **implementation:** Generated by E01 plus domain endpoints; webhooks via E12.

#### REL-013 · Readiness policies (automated checks)
- **name_fa:** سیاست‌های آمادگی (بررسی‌های خودکار)
- **group:** Readiness and risk
- **description:** A library of named checks bound to phases: all work items done, all changes approved, approvals complete, tests passed and coverage threshold met, no open critical defects, KB articles and runbooks published, monitoring and alerts configured, support group trained, rollback rehearsed, communications sent, security review passed. Each check returns pass/fail with a message; checks run on demand, on a schedule and at phase exit; failing checks block the transition unless waived with a reason and an approver; status rolls up for multi-product releases.
- **sources:** SN DPR (release policies grouped by phase, Run Policies, roll-up); MOF 4.0 (release readiness review); COBIT BAI07.06; ITIL 4 (traceability-based go/no-go)
- **tier:** P0 · **ai:** no
- **implementation:** `release_policy_check` (condition AST or flow returning pass/fail and message) and `release_policy_result`; evaluation by E03/E09; waivers via E04.

#### REL-014 · Go/no-go decision
- **name_fa:** تصمیم اجرا یا توقف (Go/No-Go)
- **group:** Readiness and risk
- **description:** A readiness-review meeting or asynchronous approval with checklist results, risk score, open defects, conflicts and freeze status; approvers include release manager, operations, service desk, security and business owner; the decision (go / no-go / go with conditions) and its rationale are recorded; no-go returns the release to the relevant phase.
- **sources:** ITIL 4; MOF 4.0 (Release Readiness management review); COBIT BAI07.06; ISO/IEC 20000-1 (acceptance before deployment); BMC (milestone approvals)
- **tier:** P0 · **ai:** no
- **implementation:** `go_no_go_decision(release_id, decision, conditions, rationale)` plus E04 approvals; meeting mode reuses the CAB workbench (CHG-037).

#### REL-015 · Release risk score
- **name_fa:** امتیاز ریسک انتشار
- **group:** Readiness and risk
- **description:** A deterministic score: the share of overdue tasks and the share of failed policies, each tiered (0 if under 10%, 1 if 10–40%, 2 if over 40%) and weighted by the elapsed share of the release window, mapped to Low/Medium/High/Very High; plus aggregation of child-change risk P(any fails) = 1 − Π(1 − pᵢ), the number of teams and services touched, and proximity to freezes. A single aggregated score exists for stage-based releases; recomputed on task and policy updates.
- **sources:** SN DPR (release risk score from overdue tasks and failed policies; aggregated score for stage-based releases); ai.md (child-change aggregation)
- **tier:** P1 · **ai:** no
- **implementation:** E03 formula fields recomputed by E08 on task/policy events.

#### REL-016 · AI release risk prediction
- **name_fa:** پیش‌بینی ریسک انتشار با هوش مصنوعی
- **group:** Readiness and risk
- **description:** An ML model predicts release failure (rollback or P1/P2 incidents within N days) from scope size, test and defect history, child-change risks, team history and timing; shows top factors and a readiness risk narrative.
- **sources:** SDP (Zia release risk prediction, May 2026); standards.md (readiness risk assessment from test, defect and change history); ITIL v5 (risk assessment and deployment optimization in Transition)
- **tier:** P1 · **ai:** yes
- **implementation:** E20 model on release outcomes; narrative via E17.

#### REL-017 · AI release briefing and blocker detection
- **name_fa:** گزارش هوشمند وضعیت انتشار و شناسایی موانع
- **group:** Readiness and risk
- **description:** Summarizes release status for stakeholders (what is in, what is blocked, readiness gaps, risks), detects blockers (dependencies not done, failing checks, unapproved changes, missing sign-offs), flags delivery risk and answers questions in Persian.
- **sources:** JSM/Atlassian (Readiness Checker, Blocker Checker, Jira Delivery Agent); SN (summaries)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skill over workspace data; Q&A through an E18 agent with read tools.

#### REL-018 · Release scope and traceability matrix
- **name_fa:** دامنه انتشار و ماتریس ردیابی
- **group:** Readiness and risk
- **description:** Requirement × test × defect × change × release traceability; problems and known errors fixed by the release; requests and incidents caused by or initiating a release; automated go/no-go conditions (all must-have requirements have passing tests; no open critical defects).
- **sources:** ITIL 4 (traceability matrix for go/no-go automation); IT4IT (R2D data objects); SDP (problem ↔ release; requests caused by or initiating a release)
- **tier:** P1 · **ai:** no
- **implementation:** `record_link` kinds plus an E15 matrix view; checks reused by REL-013.

#### REL-019 · Environment registry
- **name_fa:** ثبت محیط‌ها
- **group:** Deployment
- **description:** Environments (development, test, UAT, staging, production, DR) as CIs with owner, purpose, protection level, required approvals and windows, allowed deployment approaches, allowed data classes (no production personal data in test) and mapping to pipelines; separation of environments is enforced.
- **sources:** ITIL 4 (environment: a subset of IT infrastructure for a purpose); ISO/IEC 27001 A.8.31, A.8.33; COBIT BAI07
- **tier:** P0 · **ai:** no
- **implementation:** CMDB CI class `environment` (with `cmdb`) plus release attributes; referenced by deployments and gates.

#### REL-020 · Deployment record
- **name_fa:** رکورد استقرار
- **group:** Deployment
- **description:** One record per deployment to an environment: release and change links, environment, approach (big bang, phased, canary, blue-green, ring, pull, continuous), targets (CIs, user segments, % rollout), planned/actual start and end, per-target result, pipeline run id, artifact version and digest, automated test results, initiated by a machine identity on behalf of a person, planned vs unplanned-remediation tag, rollback flag. Production deployments must link an authorized change or a standard-change policy; violations are blocked or flagged.
- **sources:** ITIL 4 (deployment management and approaches); standards.md (planned vs remediation tagging); JSM (deployment records from Bitbucket/GitHub/GitLab/Jenkins); SN (DevOps Change Velocity deployments)
- **tier:** P0 · **ai:** no
- **implementation:** `deployment` (prefix DEP, shared with `devops`) and `deployment_target`; policy check on create.

#### REL-021 · Deployment plans: waves, rings and targets
- **name_fa:** طرح استقرار: موج‌ها، حلقه‌ها و اهداف
- **group:** Deployment
- **description:** Deployments planned as ordered waves or rings (e.g. pilot site → branch offices → all) with target groups, a schedule per wave inside maintenance windows, verification steps and a go/no-go between waves; progress per wave; automatic pause when failures pass a threshold.
- **sources:** ITIL 4 (phased deployment; deployment lifecycle: plan, verify components, verify targets, execute, verify)
- **tier:** P1 · **ai:** no
- **implementation:** `deployment_plan` with `deployment_wave[]`; orchestration via E09; windows via E06.

#### REL-022 · Deployment completion: verification and CMDB update
- **name_fa:** تکمیل استقرار: تأیید سلامت و به‌روزرسانی CMDB
- **group:** Deployment
- **description:** Post-deployment verification (smoke tests, health checks, monitoring signals) is recorded on the deployment. On success CMDB CI versions and attributes are updated and the release's `deployed_at` is set; on failure a remediation path opens (rollback deployment, incident) with evidence attached.
- **sources:** ISO/IEC 20000-1 §8.2.6 (configuration information updated after deployment); ITIL 4 (verify the deployment); standards.md
- **tier:** P0 · **ai:** no
- **implementation:** E09 flow on deployment state; CMDB update API (`cmdb`); `verification_result jsonb`.

#### REL-023 · Definitive media library and artifact registry
- **name_fa:** کتابخانه مرجع نرم‌افزار (DML) و مخزن مصنوعات
- **group:** Deployment
- **description:** A controlled register of authorized versions of internal builds and third-party software: name, version, digest, signature, SBOM (SPDX 3.0, CycloneDX) with components and licences, provenance (build and source commit), approval status and storage location (Nexus, Artifactory, Harbor, file share). Software CIs reference approved versions; the DML is the source for pull deployments and licence compliance; vulnerable components are flagged.
- **sources:** ITIL heritage (DML); ITIL 4 (pull deployment from a controlled repository); ISO/IEC 27001 A.8.25–8.30; NIST CSF PR.PS-06; standards.md (SBOM, provenance)
- **tier:** P1 · **ai:** no
- **implementation:** `artifact` (prefix ART) and `sbom_component`; registry connectors via E12; links to ITAM software models and security vulnerabilities.

#### REL-024 · Feature flags and progressive delivery
- **name_fa:** پرچم ویژگی و تحویل تدریجی
- **group:** Deployment
- **description:** Tracks deployed versus released: feature-flag records (key, service, environments, segments, % rollout, owner, kill switch), flag change events from flag services, and `released_at` per feature. A release can be "deployed dark" and released later; flag changes appear on the CI timeline for incident investigation.
- **sources:** ITIL 4 (release decoupled from deployment via feature flags); IT4IT 3.0 (Deploy vs Release); JSM (feature-flag changes in the incident investigation view); ITIL 4 HVIT
- **tier:** P1 · **ai:** no
- **implementation:** `feature_flag` (prefix FF) and `flag_event` ingested via E12 webhooks from flag services.

#### REL-025 · Pull deployment through self-service
- **name_fa:** استقرار کششی از طریق سلف‌سرویس
- **group:** Deployment
- **description:** Approved software versions are published in the portal catalogue; users or devices install them when they choose (through endpoint-management integration); licences are checked against ITAM; installation results are recorded per target.
- **sources:** ITIL 4 (pull deployment)
- **tier:** P2 · **ai:** no
- **implementation:** Catalog item linked to an `artifact`; endpoint-management connectors via E12.

#### REL-026 · Test environment booking
- **name_fa:** رزرو محیط آزمون
- **group:** Deployment
- **description:** Reserve shared test, UAT and staging environments for time slots with conflict checks, approval for long bookings, automatic release at the end, and a calendar view.
- **sources:** COBIT BAI07 (test environment); ITIL 4 SVT (test-environment booking)
- **tier:** P1 · **ai:** no
- **implementation:** `environment_booking` (prefix EB) with interval checks via E06.

#### REL-027 · Test management
- **name_fa:** مدیریت آزمون
- **group:** Validation and testing
- **description:** Test strategy per product, test plan per release, test cases (preconditions, steps, expected results, priority, type: functional, regression, performance, security, usability, accessibility, integration, smoke, UAT, operational acceptance), test suites, test runs with results (passed, failed, blocked), evidence attachments, ingestion of automated results (JUnit/xUnit from pipelines) and requirement coverage.
- **sources:** ITIL 4 (service validation and testing); ITIL v5 (test types, risk-based testing); SN (Test Management 2.0); IT4IT (Test Case)
- **tier:** P1 · **ai:** no
- **implementation:** `test_plan` (TP), `test_case` (TC), `test_suite`, `test_run` (TR), `test_result`; ingestion via E12.

#### REL-028 · Defect tracking
- **name_fa:** مدیریت نقص‌ها
- **group:** Validation and testing
- **description:** Defects with severity, priority, environment found in, linked test case, requirement and release, fix version, and states New → Triaged → In progress → Fixed → Verified → Closed (plus Deferred and Rejected). Deferred defects shipped in a release become known errors; escaped defects (found in production) are tagged; sync with external trackers.
- **sources:** ITIL 4 SVT (defects, known errors when released with defects); IT4IT (Defect); standards.md
- **tier:** P1 · **ai:** no
- **implementation:** `defect` (prefix DEF) on E01/E02; known-error creation in `problem`; tracker sync via E12.

#### REL-029 · Acceptance criteria, UAT and operational acceptance
- **name_fa:** معیار پذیرش، آزمون پذیرش کاربر و پذیرش عملیاتی
- **group:** Validation and testing
- **description:** Service acceptance criteria per release or service (functional, operational, support readiness); a UAT stage with statuses (In progress, Pending acceptance, On hold, Accepted, Rejected) and a UAT owner; an operational acceptance checklist (monitoring, backups, runbooks, support handover); formal sign-off approvals with evidence; rejection loops back to Build/Test.
- **sources:** SDP (UAT stage and UAT owner role); ITIL 4 SVT (acceptance criteria, UAT, operational acceptance); ISO/IEC 20000-1 §8.5.2 (service acceptance criteria); FitSM PR1.3
- **tier:** P0 · **ai:** no
- **implementation:** `acceptance_criterion` rows plus E04 sign-off; UAT stage in E02.

#### REL-030 · AI test-case generation and failure triage
- **name_fa:** تولید مورد آزمون و تحلیل شکست آزمون با هوش مصنوعی
- **group:** Validation and testing
- **description:** Generates test cases from requirements, stories, change descriptions and issue context, including negative cases and Persian-text edge cases (Arabic vs Persian ye/kaf, ZWNJ, Jalali dates, RTL layout); clusters failing automated tests by probable cause and links them to recent commits.
- **sources:** FS (Copilot Test Case Generator); ITIL v5 (AI-assisted testing in Build); ai.md
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skills `test.generate` and `test.triage` with E19 similarity to past failures.

#### REL-031 · Test data controls
- **name_fa:** کنترل داده‌های آزمون
- **group:** Validation and testing
- **description:** Rules and evidence that production personal or sensitive data is not used in test unless masked; test-data requests with approvals; records of masking jobs.
- **sources:** ISO/IEC 27001 A.8.33 (test information); COBIT BAI07 (test data controls)
- **tier:** P2 · **ai:** no
- **implementation:** Catalog item and checklist; data classes from field-class metadata.

#### REL-032 · Service design and transition package for major changes
- **name_fa:** بسته طراحی و انتقال سرویس برای تغییرات بزرگ
- **group:** Transition and support
- **description:** For new or removed services and other major-impact changes (as defined by the change policy): plan (authorities, activities, timescales, human, technical, information and financial resources, dependencies, testing, service acceptance criteria, measurable intended outcomes), design (responsibilities, resource changes, training needs, new or changed SLAs and contracts, SMS changes), build and transition (testing against requirements and acceptance criteria, service catalogue update, report of results against intended outcomes).
- **sources:** ISO/IEC 20000-1 §8.5.2.1–8.5.2.3; FitSM PR1.3
- **tier:** P1 · **ai:** no
- **implementation:** `transition_package` (prefix STP) linked to change, release or project, with checklist sections and approvals; catalogue-update task.

#### REL-033 · Release communications and training
- **name_fa:** اطلاع‌رسانی و آموزش انتشار
- **group:** Transition and support
- **description:** Release dates and contents published to the service desk and to incident and request management; end-user announcements and "what's new" pages in the portal; planned downtime announcements; training plans and post-deployment training tasks; linked KB articles; delivery by e-mail, portal, SMS and messengers.
- **sources:** ISO/IEC 20000-1 §8.5.3 (results and future release dates communicated); SDP (post-deployment training, planned downtime announcements); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** E11 plus portal publishing; tasks created from the template.

#### REL-034 · Early life support (hypercare)
- **name_fa:** پشتیبانی دوره آغازین (مراقبت ویژه)
- **group:** Transition and support
- **description:** An early-life-support window per release with elevated monitoring, automatic tagging of incidents on released components (by deployed CI version and window), priority routing to the release team, a daily dashboard (incident rate, SLA attainment), exit criteria and formal handover to operations.
- **sources:** ITIL heritage (early life support); COBIT BAI07.07; standards.md
- **tier:** P1 · **ai:** no
- **implementation:** `els_end_at` on release; E09 rule creating `record_link(kind=released_in)` for matching incidents; E15 dashboard.

#### REL-035 · Known errors accepted at go-live
- **name_fa:** خطاهای شناخته‌شده پذیرفته‌شده هنگام استقرار
- **group:** Transition and support
- **description:** Defects accepted into production are registered as known errors with workarounds, linked to the release, visible to the service desk and the virtual agent, and closed automatically when a later release fixes them.
- **sources:** ITIL heritage (known errors from development); ITIL 4 (problem and known error)
- **tier:** P1 · **ai:** no
- **implementation:** Known-error creation (`problem`) from deferred defects; `fixed_in_release` link.

#### REL-036 · Release review and success analysis
- **name_fa:** بازبینی انتشار و تحلیل موفقیت
- **group:** Transition and support
- **description:** Post-release review against success criteria (no rollback, no P1/P2 incident within N days, early-life-support exit met, schedule met), lessons learned and actions; success and failure trends analysed and published.
- **sources:** ISO/IEC 20000-1 §8.5.3 (success and failure monitored and analysed); ITIL 4 (release review); COBIT BAI07.08
- **tier:** P0 · **ai:** no
- **implementation:** Review checklist on the release plus E15 metrics.

#### REL-037 · AI release notes
- **name_fa:** یادداشت انتشار با هوش مصنوعی
- **group:** AI and integration
- **description:** Generates release notes from linked changes, stories, commits, pull requests and fixed problems; classifies items (feature, fix, security, breaking change, known issue); produces audience variants (plain Persian for end users, detailed for operations, English on request); every line cites its source item; editable and publishable to portal, KB and messenger channels.
- **sources:** SN (Generate Release Notes skill, DPR AI release notes); JSM (Rovo Release Notes Drafter); standards.md; ai.md
- **tier:** P0 · **ai:** yes
- **implementation:** E17 skill `release.notes` with citation enforcement and audience templates.

#### REL-038 · Work-item import from development trackers
- **name_fa:** دریافت اقلام کاری از ابزارهای توسعه
- **group:** AI and integration
- **description:** Imports fix versions as releases and selected work-item types (Jira, Azure DevOps, GitLab) as release scope items ("product enhancements"); status sync; version events trigger flows.
- **sources:** SN DPR (Jira Fix Versions create releases; selectable Jira/Azure DevOps work-item types); JSM (version automation triggers)
- **tier:** P1 · **ai:** no
- **implementation:** E12 connectors with type mapping per product.

#### REL-039 · AI release engineer recommendation
- **name_fa:** پیشنهاد مهندس انتشار
- **group:** AI and integration
- **description:** Suggests the best release engineer or coordinator from expertise (past successful releases on similar components), availability and current load.
- **sources:** SDP (Zia release engineer prediction); ai.md (expertise vectors)
- **tier:** P2 · **ai:** yes
- **implementation:** E19 expertise vectors plus availability from `workforce`; proposal only.

#### REL-040 · Release reporting
- **name_fa:** گزارش‌های انتشار
- **group:** AI and integration
- **description:** Release success rate, on-schedule rate, rollback rate, escaped defects, deployment frequency per product, incidents during early life support, readiness pass rate and schedule variance, with drill-down and deployed-release filters.
- **sources:** FS (release reports); SN; ITIL 4 (release metrics); DORA metrics
- **tier:** P0 · **ai:** no
- **implementation:** E15 metric definitions (see KPIs).

### Data model

| Table | Prefix | Key fields |
|---|---|---|
| `release` | REL | number, name, version, type, template_version_id, product_id/service_id, priority, release_manager_id, coordinator_id, assignment_group_id, parent_id, planned_start/end, readiness_target_at, window_start/end, actual_start/end, deployed_at, released_at, build/test/deployment/rollback plans, risk_score, risk_band, frozen_until, els_end_at, go_no_go, outcome, project_id, state, status_reason |
| `release_phase` | — | release_id, seq, name, planned/actual dates, ci_scope, state |
| `release_task` | RTASK | release_id, phase_id, assignee, group, depends_on[], due, state |
| `release_template`, `release_policy` | — | versioned blueprints; versioned policy |
| `release_policy_check`, `release_policy_result` | — | check definition (AST/flow), phase binding; result pass/fail, message, waived_by, waiver_reason |
| `release_manifest_item` | — | release_id, item_type (change, deployment, artifact, activity), item_id, phase_id |
| `release_dependency` | — | from_release_id, to_release_id, type |
| `go_no_go_decision` | — | release_id, decision, conditions, rationale, decided_at |
| `deployment` (shared with devops) | DEP | release_id, change_id, environment_id, approach, kind (planned/remediation), artifact_id, pipeline_run_id, initiated_by (machine), on_behalf_of, planned/actual start-end, result, rollback_of, verification_result |
| `deployment_target`, `deployment_plan`, `deployment_wave` | — | deployment_id, ci_id/segment, result; ordered waves with targets and windows |
| `environment` (CMDB CI class) | ENV | purpose, protection level, approvals required, allowed data classes |
| `environment_booking` | EB | environment_id, requester, start, end, purpose, state |
| `artifact`, `sbom_component` | ART | name, version, digest, signature, provenance, approval_state, location; component, version, licence, vulnerability refs |
| `feature_flag`, `flag_event` | FF | key, service_id, environments, segments, rollout %, owner; event type, at, actor |
| `test_plan`, `test_case`, `test_suite`, `test_run`, `test_result` | TP / TC / TR | release_id, requirement links, steps, expected, type; run state, result, evidence |
| `defect` | DEF | severity, priority, found_in_env, test_case_id, release_id, fix_version, escaped flag, known_error_id, state |
| `acceptance_criterion` | — | release_id/service_id, kind (functional/operational/support), status, evidence, signed_by |
| `transition_package` | STP | change_id/release_id/project_id, plan/design/transition sections, approvals |
| `release_note` | — | release_id, audience, language, body, sources[], version |

**States**

| Record | States (category) |
|---|---|
| release | Draft (new) → Planning, Build, Test (active) → Readiness / go-no-go (waiting) → Deploying (active) → Early life support, Review (resolved) → Closed (closed); Cancelled (canceled); On hold / Frozen (waiting) |
| deployment | Planned (new) → Pending approval / gated (waiting) → In progress (active) → Succeeded, Failed, Rolled back (resolved) → Closed (closed); Cancelled (canceled) |
| test_run | Not started (new) → In progress (active) → Passed / Failed / Blocked (resolved) → Closed (closed) |
| defect | New (new) → Triaged, In progress (active) → Fixed (resolved) → Verified/Closed (closed); Deferred (waiting); Rejected (canceled) |
| environment_booking | Requested (new) → Approved (waiting) → Active (active) → Released (closed); Cancelled (canceled) |

**Relationships:** release n–n change (manifest); release 1–n phase, task, deployment, test plan, defect, note; release n–1 parent release; release n–n release (dependency); deployment n–1 environment, n–1 artifact, 1–n target, n–1 change; artifact 1–n SBOM component; defect n–1 test case, n–1 release, 0–1 known error; release n–1 project; release n–n requirement (via project module).

**Access-scoping fields:** owner/assigned = `release_manager_id`, `coordinator_id`, task assignees; group = `assignment_group_id`; service = `service_id`/product (service-subtree keys); project = `project_id`; participant = approvers, go/no-go approvers, CAB-style shares; inherited = read keys from linked changes and services; domain/workspace = `domain_id`, `workspace_id`; environment protection decides who may approve or execute deployments; deployments created by pipelines carry the machine principal plus `on_behalf_of`. Test and defect records inherit the release's keys.

### KPIs

| KPI | Formula | Target / note |
|---|---|---|
| Release success rate | releases without rollback and without P1/P2 incident within N days ÷ releases | trend up |
| On-schedule release rate | releases deployed by planned date ÷ releases deployed | ≥ 90% |
| Release schedule variance | actual go-live − planned go-live (days, median) | → 0 |
| Deployment success rate | successful deployments ÷ deployments | — |
| Rollback rate | deployments rolled back ÷ deployments | low |
| Mean deployment duration | avg(actual_end − actual_start) per environment | trend down |
| Escaped defect rate | defects found in production ÷ total defects (per release) | trend down |
| Test coverage | requirements with passing tests ÷ requirements in scope | 100% for must-haves |
| UAT first-pass rate | UAT cycles accepted at first attempt ÷ UAT cycles | — |
| Readiness pass rate | releases with all checks passed (no waivers) at go/no-go ÷ releases | — |
| Release-related incident share | incidents linked to a release (released_in/caused_by) ÷ all incidents | — |
| ELS incident rate | incidents tagged to a release during ELS ÷ ELS days | below exit criterion |
| Release backlog throughput | releases closed per period; scope items delivered per release | — |
| Release risk calibration | failure rate per release risk band | monotonic |
| Deployment frequency (per product) | production deployments per day/week | see devops |

### Beyond the market
- **Persian release notes for each audience:** AI drafts formal Persian notes for end users and technical notes for operations, with citations, and publishes them to the portal, the in-app «تازه‌ها» page and Bale/Eitaa/Telegram channels.
- **Air-gapped and sanction-aware delivery:** a DML that exports signed release bundles for networks without internet access and verifies hashes on import; SBOM entries flagged when a dependency's upstream registry is blocked or unreliable from Iran, with the internal mirror to use instead.
- **Holiday- and Ramadan-aware release calendar:** release windows avoid Nowruz, lunar holidays and Ramadan's shortened working hours automatically; Jalali versioning (e.g. 1405.02) is supported.
- **Hypercare in the Windows app:** release teams follow early-life-support incidents, verification checks and rollback steps in the desktop replica, even offline.
- **Persian-text test packs:** AI-generated test cases cover Persian/Arabic character variants, ZWNJ, Persian digits, Jalali dates and RTL layout, which no vendor provides.

## Module: devops — دواپس و تحویل پیوسته

DevOps connects the ITSM to the software delivery toolchain: code, pipelines, tests, scans, artifacts and deployments are linked to services, changes, incidents and problems; pipelines create and gate changes on evidence; delivery and reliability are measured with DORA and flow metrics. It covers ITIL 4 software development and management and the high-velocity IT outcomes (fast development, resilient operations, assured conformance).

### Features

#### DEV-001 · DevOps tool connections
- **name_fa:** اتصال به ابزارهای دواپس
- **group:** Toolchain and traceability
- **description:** Registry of connections to code hosting (GitHub, GitLab including self-hosted, Bitbucket, Azure Repos, Gitea), CI/CD (Jenkins, GitHub Actions, GitLab CI, Azure Pipelines, Harness, Argo CD, Tekton, Octopus), planning tools (Jira, Azure Boards, GitLab issues), artifact registries (Nexus, Artifactory, Harbor), code-quality and security scanners (SonarQube, SAST/DAST/SCA and secret scanners) and feature-flag services. Each connection uses its own machine identity with scoped, expiring tokens and webhook secrets, shows a health status and can be enabled per workspace.
- **sources:** SN (DevOps Change Velocity integrations with planning, code, CI/CD, test and security tools); JSM (Bitbucket, GitHub, GitLab, Jenkins); FS (Jira, Azure DevOps, GitHub, GitLab apps); SDP (Azure DevOps, GitLab, Jira, BugTracker); BMC (Azure DevOps, Jira, Rally via Multi-Cloud Broker); Zammad (GitHub/GitLab links)
- **tier:** P0 · **ai:** no
- **implementation:** `devops_connection(kind, base_url, principal_id, scopes, webhook_secret_ref, health, last_event_at)`; E12 connectors; secrets encrypted at rest.

#### DEV-002 · Repository and pipeline mapping to services
- **name_fa:** نگاشت مخزن و خط لوله به سرویس‌ها
- **group:** Toolchain and traceability
- **description:** Maps repositories, pipelines, pipeline steps and environments to CMDB applications, services and CIs (explicit mapping, suggested from names and service IDs placed in pipeline configuration); records the owning team, which pipeline steps are under change control and which change model each environment uses.
- **sources:** SN DCV (apps, pipelines and steps linked to the CMDB; steps flagged for change control); JSM (service ID in pipeline configuration); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** `dev_repository(service_id, owner_group_id)`, `dev_pipeline(service_id, environments, step_controls jsonb)`.

#### DEV-003 · DevOps event ingestion and normalized model
- **name_fa:** دریافت رویدادهای دواپس و مدل داده یکسان
- **group:** Toolchain and traceability
- **description:** Signed webhooks for commits, branches, pull/merge requests (reviews and approvals), builds and pipeline runs with steps, test summaries, scan results, artifacts and deployments are normalized into one model (run → steps → artifacts → commits → work items → target service/CI). Re-runs are deduplicated; keys in commit messages and branch names link events to work items, changes, incidents and problems; retention is configurable.
- **sources:** ITIL 4 (VCS/CI/CD events into a dev-event store); SN DCV; JSM (DevOps automation triggers); analytics_ux (dedupe re-runs)
- **tier:** P0 · **ai:** no
- **implementation:** `dev_event` (raw, signature-verified) → `dev_commit`, `dev_branch`, `dev_pull_request`, `dev_build`, `dev_test_summary`, `dev_scan_result`, `deployment`; E12 intake plus E08 workers; key-extraction patterns per tenant.

#### DEV-004 · Development panel on records
- **name_fa:** پنل توسعه روی رکوردها
- **group:** Toolchain and traceability
- **description:** On changes, releases, incidents, problems, stories and project tasks: linked branches, commits, pull requests with peer-review evidence, builds, test results, scan results, SBOM, artifacts and deployments per environment, with status icons and deep links. Visible only to users with the "view development tools" permission.
- **sources:** ITIL 4 HVIT (source-control and pipeline traceability); JSM (development information and the View development tools permission); SN DCV
- **tier:** P0 · **ai:** no
- **implementation:** E16 panel over link tables; field class `dev` enforced by E13.

#### DEV-005 · Two-way sync with development trackers
- **name_fa:** همگام‌سازی دوطرفه با ابزارهای مدیریت کار توسعه
- **group:** Toolchain and traceability
- **description:** Change ↔ work item, incident/problem ↔ bug and request ↔ issue sync with Jira, Azure DevOps, GitLab, GitHub and Redmine: create linked items with context, sync status, comments and work logs, field mappings, comment visibility for developers without exposing internal notes, developer escalation and forwarding, and the loop fix → release → known-error closure.
- **sources:** BMC (Azure DevOps ↔ change, Jira ↔ incidents/problems, problems from Azure DevOps/Jira); SDP (Azure DevOps, GitLab, Jira links on requests, problems, changes, releases); JSM (linked Jira work, developer escalations); FS (Jira/Azure DevOps apps); Zammad (GitHub/GitLab issue links)
- **tier:** P0 · **ai:** no
- **implementation:** `external_work_link(record_type, record_id, system, key, url, sync_state, field_owner_rules)`; E12 sync engine with retry and conflict rules.

#### DEV-006 · AI developer escalation package
- **name_fa:** بسته ارجاع هوشمند به توسعه‌دهنده
- **group:** Toolchain and traceability
- **description:** Turns an incident or problem into a well-formed bug report: summary, impact, reproduction steps, environment, referenced logs and screenshots, suspected component and recent deployments, proposed severity. It is posted to the tracker only after confirmation.
- **sources:** JSM/Atlassian (Bug Report Assistant, Jira Triage Agent); ai.md
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skill `dev.bug_report` producing a proposal for the DEV-005 create action.

#### DEV-007 · Deployment tracking (change per deployment)
- **name_fa:** ردیابی استقرار (ثبت تغییر برای هر استقرار)
- **group:** Pipeline change automation
- **description:** Each deployment to selected environments creates or updates a change automatically (a standard change for pre-approved pipelines, a normal change otherwise), prefilled with commits, work items, test and scan summaries and deployment details. Actual start/end come from deployment events; deployment success, failure or cancellation transitions the change; infrastructure-as-code pipelines can generate changes for configuration changes too.
- **sources:** JSM (deployment tracking creates change requests; actual dates from deployments; deployment status transitions); SN DCV (pipeline change automation, configuration changes); BMC (REST creation from pipelines with standard templates); FS (change from pipeline); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** E09 flow on `deployment` events; change template per pipeline; state-mapping table from deployment status to change transitions.

#### DEV-008 · Deployment gating API (change gate)
- **name_fa:** دروازه استقرار (API کنترل تغییر برای خط لوله)
- **group:** Pipeline change automation
- **description:** A pipeline step calls the gate with its run context; the server creates or updates the change, evaluates the approval policy over the collected evidence and answers approved, pending or rejected. The pipeline polls (retry × sleep) or receives a callback; timeouts and a manual override exist; gating can be switched per environment; on rejection the pipeline fails with a comment linking the change. Ready-made templates for GitLab CI, GitHub Actions, Jenkins, Azure Pipelines and Bitbucket. The gate also checks windows, freezes, lockdowns and error budgets.
- **sources:** JSM (deployment gating for Bitbucket, Jenkins, GitHub via .jira/config.yml, GitLab protected environments); SN DCV (pipeline paused until the change is approved); BMC (park the pipeline until approval with webhook callback); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** `change_gate_request(run_ref, change_id, status, evidence_id, requested_at, decided_at, timeout_at)`; `POST /change-gate` plus status and callback endpoints; evaluation by E03/E04; one machine identity per pipeline.

#### DEV-009 · Evidence snapshots and change receipts
- **name_fa:** شواهد تحویل و رسید تغییر
- **group:** Pipeline change automation
- **description:** An immutable evidence snapshot per gated deployment: peer-review IDs and reviewers, test results and coverage, scan summaries and open critical findings, artifact digest and SBOM reference, linked approved work items, the policy rule versions applied and the decision. Shown as a "change receipt"; auditors get the complete population of production deployments with receipts; a replay explains why a deployment was auto-approved.
- **sources:** ITIL 4 HVIT (assured conformance, DevOps Audit Defense Toolkit); standards.md (complete population for SOC 2 sampling; every production deployment yields a change record); SN DCV (audit trail)
- **tier:** P1 · **ai:** no
- **implementation:** `change_evidence(hash, payload, rule_versions, decision)` append-only and hash-chained (E14).

#### DEV-010 · Policy as code
- **name_fa:** سیاست به‌صورت کد
- **group:** Pipeline change automation
- **description:** Change and deployment policies are expressed as versioned code (YAML or Rego-like) stored in git, reviewed by pull request and synced to the tenant; results of external policy engines (OPA, Kyverno, Sentinel, cloud policy services) are ingested as evidence; evaluation is deterministic and logged with inputs and versions.
- **sources:** ITIL 4 HVIT; ITIL v5 guidance (policy as code); standards.md
- **tier:** P1 · **ai:** no
- **implementation:** `policy_rule(source=git, path, version, compiled_ast)` compiled into E03; git sync via E12.

#### DEV-011 · Pipeline change review console
- **name_fa:** کنسول بازبینی تغییرات خط لوله
- **group:** Pipeline change automation
- **description:** A queue of pipeline-originated changes awaiting decision, with evidence, risk, gate wait time and pipeline status; bulk approve or reject where policy allows; a sample of auto-approved changes for spot checks.
- **sources:** SN DCV (DevOps > Orchestrate > Pipeline Change Requests)
- **tier:** P1 · **ai:** no
- **implementation:** E16 list preset over `change_request(origin=pipeline)` joined with `change_gate_request`.

#### DEV-012 · Planned vs remediation deployments and hotfix flow
- **name_fa:** تفکیک استقرار برنامه‌ریزی‌شده و اصلاحی و مسیر رفع فوری
- **group:** Pipeline change automation
- **description:** Deployments are tagged planned or unplanned remediation (linked to the incident that triggered them). The hotfix flow uses the emergency change model with automated rollback readiness and a mandatory post-deployment review. The tags feed deployment rework rate and change fail rate.
- **sources:** standards.md (tag deployments planned/unplanned_remediation); ITIL 4 (emergency fixes with automated rollback and post-deployment review); analytics_ux (rework rate)
- **tier:** P1 · **ai:** no
- **implementation:** `deployment.kind` plus `record_link(kind=remediates)` to the incident; hotfix flow in E09.

#### DEV-013 · DevSecOps findings and security gates
- **name_fa:** یافته‌های امنیتی دواپس و دروازه‌های امنیتی
- **group:** Pipeline change automation
- **description:** SAST, DAST, SCA, container and secret-scanning results are ingested per build; critical or high findings above policy block auto-approval or the gate; findings link to vulnerabilities, CIs and releases in the security module; exceptions are requested with an expiry.
- **sources:** ITIL 4 HVIT (DevSecOps); SN DCV (scan results in pipeline changes); standards.md
- **tier:** P1 · **ai:** no
- **implementation:** `dev_scan_result`; E03 gate conditions; exceptions approved via E04.

#### DEV-014 · Infrastructure-as-code drift ingestion
- **name_fa:** دریافت انحراف پیکربندی از زیرساخت به‌صورت کد
- **group:** Pipeline change automation
- **description:** Drift reports (Terraform plan drift, Kubernetes configuration drift, intended-state vs actual from a network source of truth such as NetBox) become events for unauthorized-change reconciliation and CMDB updates; bulk edits to intended state can be staged in branches before merging.
- **sources:** ITIL 4 HVIT (drift detection against baselines); NetBox (intended state, branching add-on); standards.md
- **tier:** P2 · **ai:** no
- **implementation:** E12 ingestion feeding the CHG-056 matcher.

#### DEV-015 · DORA metrics
- **name_fa:** شاخص‌های DORA
- **group:** Delivery metrics
- **description:** The five DORA delivery metrics per service, team and product: deployment frequency, change lead time, change fail rate, failed deployment recovery time and deployment rework rate, as medians over rolling 30/90 days and as distributions (the 2025 report replaced performance tiers). Also change-acceleration metrics (share of auto-approved changes, gate wait time, gating outcomes per pipeline) and engineering health (pull-request review time, build success rate, test pass rate). Computed from the same records as ITSM so the numbers reconcile.
- **sources:** DORA metrics (2024–2025 reports); analytics_ux (DORA five metrics, ITSM linkage); ITIL 4 / v5 (metric mapping); SN DCV Insights (flow and change acceleration metrics)
- **tier:** P1 · **ai:** no
- **implementation:** E15 metric library with versioned formulas; E08 daily aggregation into `dora_metric_snapshot(service_id, team_id, period, values)`.

#### DEV-016 · Flow metrics and value-stream analytics
- **name_fa:** شاخص‌های جریان و تحلیل جریان ارزش
- **group:** Delivery metrics
- **description:** Idea-to-production flow: flow time, flow efficiency, WIP, throughput (velocity), flow load and flow distribution (features, defects, risks, debt) across demand → backlog → build → deploy → operate, with a value-stream map showing wait states.
- **sources:** Flow Framework; ITIL 4 (value streams, CDS); IT4IT (value streams); SN DCV Insights
- **tier:** P1 · **ai:** no
- **implementation:** E15 over the state histories of demands, work items, changes and deployments.

#### DEV-017 · Production readiness review and operability Definition of Done
- **name_fa:** بازبینی آمادگی تولید و تعریف «انجام‌شده» عملیاتی
- **group:** Reliability and platform
- **description:** A checklist review before a new service or major component goes live: monitoring and alert routing, SLOs defined, runbooks and KB articles written, on-call assigned, capacity and backups, security review, support handover. The same items are reused as Definition of Done on stories and as a readiness policy in releases.
- **sources:** ITIL 4 SDM/HVIT (Definition of Done with operability items); Google SRE (production readiness reviews)
- **tier:** P1 · **ai:** no
- **implementation:** `readiness_review` (prefix PRR) from checklist templates (E24) with E04 sign-off; linked to the service CI.

#### DEV-018 · Service reliability scorecards
- **name_fa:** کارنامه پایداری سرویس
- **group:** Reliability and platform
- **description:** A scorecard per service or component: SLO attainment and error budget remaining (from `slm`), DORA metrics, incident and change-failure history, PRR status, open technical debt, security findings and ownership completeness; criteria with pass/fail and a score; a change of scorecard status can trigger flows.
- **sources:** JSM/Compass (scorecards, scorecard status change trigger); ITIL 4 HVIT (resilient operations); Google SRE
- **tier:** P1 · **ai:** no
- **implementation:** `reliability_scorecard(service_id, criteria[], results, score, computed_at)` computed by E08; criteria in E03.

#### DEV-019 · Engineering component catalog
- **name_fa:** کاتالوگ مؤلفه‌های مهندسی
- **group:** Reliability and platform
- **description:** A developer-facing catalog of software components (services, libraries, APIs, applications, capabilities) with owner team, repositories, pipelines, on-call, dependencies, documentation and scorecards; two-way sync with CMDB technical services and with external developer portals (Backstage, Compass) under field-ownership rules.
- **sources:** JSM (Compass sync with Software Services, Capabilities and Applications); ITIL v5 (platform engineering, internal developer platform)
- **tier:** P1 · **ai:** no
- **implementation:** Reuses CMDB CI classes (software service, application) with engineering attributes; E12 sync with tombstones instead of cascading deletes.

#### DEV-020 · Platform engineering golden paths
- **name_fa:** مسیرهای طلایی مهندسی پلتفرم
- **group:** Reliability and platform
- **description:** Self-service provisioning through the request catalog (new repository with a pipeline template, new environment, database, certificate, secret). Each golden path is a catalog item whose fulfilment runs automation and is registered as a pre-approved standard change; created resources become CIs.
- **sources:** ITIL v5 guidance (platform engineering, golden paths, pipeline templates as standard changes); ITIL 4 (infrastructure and platform management)
- **tier:** P1 · **ai:** no
- **implementation:** Catalog item plus E09 automation referencing a CHG-011 standard template.

#### DEV-021 · Infrastructure automation runs linked to changes
- **name_fa:** اجرای خودکارسازی زیرساخت متصل به تغییر
- **group:** Reliability and platform
- **description:** Ansible job templates, Terraform plans/applies, scripts and runbooks run as flow actions from changes and requests, with approvals for production, logs captured on the change task, and results updating CIs.
- **sources:** BMC (Helix Intelligent Automation connectors: Ansible Automation Platform, Git, Generic REST); NetBox (automation pipelines); ITIL 4
- **tier:** P1 · **ai:** no
- **implementation:** E12 connectors and E09 actions; `automation_run(target, inputs, log_ref, result, change_task_id)`.

#### DEV-022 · Technical debt register
- **name_fa:** دفتر بدهی فنی
- **group:** Reliability and platform
- **description:** Debt items with cause (a workaround chosen instead of a proper fix), interest (incidents, toil hours, delays), principal (effort to fix), owner, priority and service; known errors and long-lived workarounds roll up as debt; debt ratio per service; items flow into backlogs.
- **sources:** ITIL 4 (incident PG definition of workaround-driven debt; software development and management practice); ITIL v5
- **tier:** P1 · **ai:** no
- **implementation:** `tech_debt_item` (prefix TD) linked to services, known errors and work items.

#### DEV-023 · Chaos and resilience experiments
- **name_fa:** آزمایش‌های آشوب و تاب‌آوری
- **group:** Reliability and platform
- **description:** Experiment records: hypothesis, target service, blast radius, abort conditions, schedule (as a change), results and follow-ups; linked to continuity tests.
- **sources:** ITIL 4 HVIT (chaos engineering)
- **tier:** P2 · **ai:** no
- **implementation:** `chaos_experiment` (prefix EXP) linked to a change and to continuity test records.

#### DEV-024 · Deployment verification and rollback recommendation
- **name_fa:** پایش سلامت پس از استقرار و پیشنهاد بازگشت
- **group:** Reliability and platform
- **description:** Compares service telemetry before and after a deployment (error rate, latency, saturation, business KPIs) and flags regressions; recommends a rollback with evidence; a person (or a pre-approved policy) decides, and the decision is recorded on the deployment and the change.
- **sources:** ITIL v5 (deployment risk scoring, automated rollback decisions); ITIL 4 HVIT (AIOps); Dynatrace and BigPanda (AIOps change analysis)
- **tier:** P1 · **ai:** yes
- **implementation:** Telemetry from event and observability connectors; anomaly detection (E20) plus an E17 narrative; the rollback is an action proposal.

#### DEV-025 · AI code-change summary and risk signals
- **name_fa:** خلاصه تغییرات کد و نشانه‌های ریسک برای تأییدکنندگان
- **group:** AI and collaboration
- **description:** For approvers: a plain Persian summary of the code diff in linked pull requests (what changes, which components, data migrations), basic static checks for secrets, risky patterns and leaks, dependency changes and licence flags; shown in the change risk panel.
- **sources:** JSM (Ops Expert basic static code analysis of linked PRs); ITIL v5 (PR and change summarization)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skill over PR diffs fetched through the connector with the user's permission; a local-model option keeps code inside the network.

#### DEV-026 · AI fix proposals through coding agents
- **name_fa:** پیشنهاد اصلاح کد با عامل‌های کدنویس
- **group:** AI and collaboration
- **description:** For a problem or incident with a code-level root cause, an agent analyses logs, recent changes and code, proposes a fix and opens a pull request in the team's own repository (running on the team's CI runner); the PR links back to the problem and to the resulting change; people review and merge.
- **sources:** BMC (AIOps Deep RCA with code tools, recommendation code wizard); SN (Impact Code Fix Agent); Dynatrace (Developer agent); JSM/Atlassian (Jira Coding Agent)
- **tier:** P1 · **ai:** yes
- **implementation:** E18 coder agent dispatched to the tenant's CI runner with repo-scoped tokens; outputs are a PR and record links.

#### DEV-027 · ChatOps
- **name_fa:** عملیات گفت‌وگومحور (ChatOps)
- **group:** AI and collaboration
- **description:** Deployment notifications, gate approvals, change status and runbook actions in team chats (Bale, Eitaa, Telegram, Teams, Slack, Mattermost/Rocket.Chat): approve a gated deployment from chat with a signed action and step-up, query DORA metrics, start a rollback flow.
- **sources:** ITIL 4 HVIT (ChatOps); FS (approvals from Slack and Teams)
- **tier:** P1 · **ai:** no
- **implementation:** E11 bots plus E12; every action goes through the normal API bound to the user's identity.

#### DEV-028 · DevOps tools over MCP
- **name_fa:** ابزارهای دواپس برای عامل‌های هوشمند از طریق MCP
- **group:** AI and collaboration
- **description:** The MCP server exposes read tools (change status, deployment history, DORA metrics, conflicts, freeze windows) and gated write tools (request a change, call the change gate) to coding agents and IDEs under the user's own permissions and per-user revocable tokens.
- **sources:** ServiceNow (Action Fabric MCP server); Atlassian (Rovo MCP server used from IDEs); Xurrent (open MCP server); TOPdesk (read-only MCP); InvGate (MCP with per-user revocable tokens); ai.md (headless ITSM via MCP); access.md (own MCP server design)
- **tier:** P1 · **ai:** yes
- **implementation:** E18 MCP tool registry with risk and policy per tool (auto / confirm / approval).

#### DEV-029 · DevOps permissions and machine identities
- **name_fa:** مجوزهای دواپس و هویت‌های ماشینی
- **group:** Governance
- **description:** The "view development tools" permission; separate permissions for configuring connections, mapping pipelines and approving pipeline changes; each pipeline and connection is a machine principal with minimal grants, IP allowlist, token expiry and a named owner; the human trigger is recorded as `on_behalf_of`; extensions declare permission manifests.
- **sources:** JSM (View development tools); SN (delegated development and separate deployment permissions); access.md (non-human identities, extension manifests)
- **tier:** P0 · **ai:** no
- **implementation:** E13 principals of kind integration with scopes; audit in E14.

#### DEV-030 · Software development practice templates
- **name_fa:** الگوهای رویه توسعه نرم‌افزار
- **group:** Governance
- **description:** Templates for the development approach per product type: Definition of Ready and Done, branching and review policies, quality gates and documentation standards; used to configure checks and to evidence conformance with the software development and management practice.
- **sources:** ITIL 4 / v5 (software development and management practice: approach, Definition of Done, product-type guidelines)
- **tier:** P2 · **ai:** no
- **implementation:** E24 templates linked to policy-as-code rules (DEV-010).

### Data model

| Table | Prefix | Key fields |
|---|---|---|
| `devops_connection` | — | kind, base_url, principal_id, scopes, webhook_secret_ref, health, workspace_id |
| `dev_repository` | — | connection_id, external_id, name, default_branch, service_id, owner_group_id, visibility |
| `dev_pipeline` | — | connection_id, repository_id, name, service_id, environments, step_controls (change-controlled steps, change model) |
| `dev_event` | — | connection_id, type, external_id, payload, signature_ok, received_at, processed_at |
| `dev_commit`, `dev_branch`, `dev_pull_request` | — | sha, author, message, keys[]; branch, keys[]; PR number, author, reviewers, approvals, state, merged_at |
| `dev_build` | RUN | pipeline_id, run_number, trigger, steps, status, started_at, finished_at, on_behalf_of |
| `dev_test_summary`, `dev_scan_result` | — | build_id, totals, pass/fail, coverage; tool, severity counts, findings ref |
| `deployment` (shared with release) | DEP | see release |
| `change_gate_request` | GATE | pipeline_id, run_ref, environment, change_id, status, evidence_id, requested_at, decided_at, timeout_at, override_by |
| `change_evidence` (shared with change) | — | hash, payload, rule_versions, decision |
| `policy_rule` | — | source (git/ui), path, version, compiled_ast, active |
| `external_work_link` | — | record_type, record_id, system, key, url, sync_state, field_owner_rules |
| `dora_metric_snapshot` | — | service_id, team_id, product_id, period, deploy_freq, lead_time_p50, cfr, recovery_p50, rework_rate |
| `readiness_review` | PRR | service_id, checklist, state, approvals |
| `reliability_scorecard` | — | service_id, criteria, results, score, computed_at |
| `tech_debt_item` | TD | service_id, cause, interest, principal, owner, priority, state |
| `automation_run` | — | tool, template, inputs, log_ref, result, change_task_id |
| `chaos_experiment` | EXP | service_id, hypothesis, blast_radius, abort_conditions, change_id, result |

**States:** change_gate_request Pending (waiting) → Approved / Rejected (resolved) / Timed out (closed) / Overridden (resolved); dev_build Queued (new) → Running (active) → Succeeded / Failed / Cancelled (closed); readiness_review Draft (new) → In review (waiting) → Approved / Rejected (closed); tech_debt_item Identified (new) → Accepted (waiting) → Planned, In progress (active) → Paid (resolved/closed) / Won't fix (canceled).

**Relationships:** repository n–1 service; pipeline n–1 repository, n–1 service; build n–1 pipeline, 1–n test summaries and scan results; deployment n–1 build, n–1 change, n–1 release; commit/PR n–n work items, changes, incidents, problems (by key); gate request 1–1 change evidence, n–1 change; scorecard and debt items n–1 service.

**Access-scoping fields:** service = `service_id` (service-subtree keys); group = `owner_group_id`; domain/workspace = `domain_id`, `workspace_id`; repository visibility mirrored from the source with a freshness window (fail closed when stale); all development data carries field class `dev` (needs the view-development-tools grant); machine principals record `on_behalf_of` for human triggers.

### KPIs

| KPI | Formula | Target / note |
|---|---|---|
| Deployment frequency | production deployments per service per day or week | on demand for top performers |
| Change lead time | median(deployed_at − first_commit_at) for changes reaching production | < 1 day for top performers |
| Change fail rate | deployments needing immediate remediation (rollback, hotfix or linked incident within N hours) ÷ deployments | ≈ 5% historical elite mark |
| Failed deployment recovery time | median(restored_at − failed_deployment_at) for deployment-caused failures | < 1 h for top performers |
| Deployment rework rate | unplanned deployments caused by production incidents ÷ deployments (e.g. 3 of 10 = 30%) | trend down |
| Auto-approval share | pipeline changes approved by policy ÷ pipeline changes | trend up with stable CFR |
| Gate wait time | median(decided_at − requested_at) of gate requests | minutes for low risk |
| Gate outcomes | approved / rejected / timed-out ÷ gate requests per pipeline | — |
| Flow time / flow efficiency | done_at − started_at; active time ÷ flow time | efficiency trend up |
| Flow load / distribution | WIP count; share of features, defects, risks, debt in flow | balanced |
| Pull-request review time | median(first_review_at − opened_at) and (merged_at − opened_at) | — |
| Build success rate | successful builds ÷ builds | — |
| Technical debt ratio | debt effort ÷ total development effort | trend down |
| Escaped defects per release | defects found in production per release | trend down |
| SLO attainment / error budget remaining | from `slm`: 1 − (bad events ÷ allowed bad events) | per SLO |
| PRR coverage | services in production with an approved PRR ÷ services in production | 100% |

### Beyond the market
- **Built for Iranian toolchains and networks:** first-class connectors for self-hosted GitLab, Gitea, Jenkins, Harbor and Nexus behind the firewall, no dependency on foreign SaaS, and full operation on air-gapped or National-Information-Network-only networks.
- **Gate approvals in local messengers:** gated deployments approved from Bale or Eitaa with signed actions and step-up, and deployment notifications to team channels in Persian.
- **Code stays home:** AI code summaries, risk signals and fix proposals can run on a local model, so source code never leaves the organization; the coding agent runs on the team's own runner.
- **Supply-chain availability risk:** dependencies pulled from registries that are blocked or throttled from Iran are flagged in SBOM and evidence, with the approved internal mirror suggested.
- **One truth for DORA and ITSM:** DORA metrics, change failure and incident data come from the same records, with Jalali periods and Persian dashboards, so engineering and service management stop arguing about numbers.

## Module: project — مدیریت پروژه و سبد پروژه‌ها

Project, programme and portfolio management makes sure the organization runs the right mix of investments within its funding and resource limits and delivers each one under control (ITIL 4 portfolio and project management; ISO 21502–21504). Ideas and demands are triaged and scored, approved through stage gates, delivered as predictive, agile or hybrid projects, and tracked for schedule, cost, resources, risks and benefits. Projects deliver into production only through change and release.

### Features

#### PRJ-001 · Idea portal
- **name_fa:** درگاه ایده‌ها
- **group:** Demand and intake
- **description:** Employees submit ideas in the portal (title, problem, expected benefit, category, attachments), vote and comment; moderators merge duplicates, set status (new, under review, accepted, declined, implemented) and convert ideas into demands; idea campaigns with deadlines; service tickets can be linked to ideas as evidence of need.
- **sources:** SN (Ideas with voting and comments, idea → demand); JSM/Atlassian (Jira Product Discovery ideas linked from service work items); ITIL 4 (idea and demand intake)
- **tier:** P1 · **ai:** no
- **implementation:** `idea` (prefix IDEA), `idea_vote`; audience bindings (E13) for who may see and vote; conversion flow via E09.

#### PRJ-002 · Demand record and lifecycle
- **name_fa:** رکورد تقاضا و چرخه عمر آن
- **group:** Demand and intake
- **description:** Demands come from the portal, ideas, the improvement register, problems, customer feedback and strategy. Fields: type (project, enhancement, change, defect, new-service proposal), business owner and sponsor, problem statement, objectives, strategic alignment, estimated cost (capex/opex), estimated effort per role, expected benefits, risk and dependencies. States: Draft → Submitted → Screening → Qualified → Approved → Converted/Completed, or Deferred / Rejected. Conversion creates a project, enhancement, change or epic, carries cost and resource plans and keeps lineage.
- **sources:** SN (Demand Management: business case, demand stages, conversion); Ivanti (demands with Resource Estimated Effort, Demand Manager role); ITIL 4 / v5 (demand intake, Discover stage); ISO/IEC 20000-1 §8.2.2 (service proposals); FitSM PR1.2; COBIT BAI02
- **tier:** P0 · **ai:** no
- **implementation:** `demand` (prefix DMD) on E01/E02; conversion actions in E09 with `record_link(kind=converted_from)`.

#### PRJ-003 · Demand assessment and scoring
- **name_fa:** ارزیابی و امتیازدهی تقاضا
- **group:** Demand and intake
- **description:** Assessment questionnaires (value, risk, size) sent to stakeholders; scoring models WSJF (cost of delay ÷ job size), RICE (reach × impact × confidence ÷ effort), weighted scoring against strategic objectives and MoSCoW; a demand workbench with a bubble chart (value vs risk vs size) and stage filters; a ranked backlog.
- **sources:** SN (demand assessments, demand workbench bubble chart); ITIL 4 (WSJF, RICE, weighted scoring); SAFe (WSJF)
- **tier:** P1 · **ai:** no
- **implementation:** E05 questionnaires plus E03 scoring formulas; bubble chart in E16.

#### PRJ-004 · Business case and investment appraisal
- **name_fa:** طرح توجیهی و ارزیابی سرمایه‌گذاری
- **group:** Demand and intake
- **description:** Options analysis, one-off and running costs, financial and non-financial benefits, NPV, IRR, payback and sensitivity, risks and assumptions, version history, approval through stage gates and links to the benefits register.
- **sources:** ITIL 4 (business cases and benefits); COBIT APO05; ISO 21502; PRINCE2 7 (business case)
- **tier:** P1 · **ai:** no
- **implementation:** `business_case` (prefix BC; versioned document plus numeric model); formulas in E03; field class `financial`.

#### PRJ-005 · Stage gates as approvals
- **name_fa:** دروازه‌های مرحله‌ای به‌صورت تأیید
- **group:** Demand and intake
- **description:** Gate templates (idea → business case → initiate → stage n → close) with required artefacts (charter, plan, risk register, budget) and approvers (project board or executive, portfolio owner, architecture board, security, finance). Gates block progress until approved, in the PRINCE2 pattern "authorize initiation / the project / a stage or exception plan / closure".
- **sources:** ITIL 4 (stage gates); PRINCE2 7 (directing a project); ISO 21502
- **tier:** P0 · **ai:** no
- **implementation:** E02 phases with gate transitions; E04 approval plans; required-artefact checks in E03.

#### PRJ-006 · AI demand summarization, validation and conversion
- **name_fa:** خلاصه‌سازی، اعتبارسنجی و تبدیل تقاضا با هوش مصنوعی
- **group:** Demand and intake
- **description:** Summarizes demands; checks completeness and duplicates (similar demands, existing projects and services); proposes scoring inputs, the right conversion target (project, enhancement, change, catalog request) and a draft charter; acts only after confirmation.
- **sources:** SN (demand summarization; Demand Management Automation with AI specialists validating and converting demands)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skills plus E19 duplicate search; proposal-only writes.

#### PRJ-007 · Portfolio and programme hierarchy
- **name_fa:** سلسله‌مراتب سبد و برنامه
- **group:** Portfolio and strategy
- **description:** Portfolios (by business unit, strategy or investment class) contain programmes, projects, products and demands; programmes hold benefits, component projects and shared risks; an EPS-like tree drives roll-ups and access; portfolio owner and portfolio manager roles.
- **sources:** ITIL 4 (portfolio management); SN (pm_portfolio, pm_program); COBIT BAI01, APO05; ISO 21503/21504; Ivanti (portfolios); Clarity PPM and Primavera P6 (OBS/EPS reference)
- **tier:** P1 · **ai:** no
- **implementation:** `portfolio` (PFL), `program` (PGM) with parent trees and a closure table (E13 subtree keys); roll-ups via E08.

#### PRJ-008 · Strategic goals and OKRs
- **name_fa:** اهداف راهبردی و OKR
- **group:** Portfolio and strategy
- **description:** Strategic priorities, goals and key results with targets and periods (Jalali fiscal years and quarters), owners and check-ins; demands, projects and epics align to goals; alignment heat map and share of spend aligned; progress rolls up from linked work.
- **sources:** SN (Strategic Planning goals and targets); ITIL v5 (OKRs); JSM/Atlassian (Goals, OKR Generator)
- **tier:** P1 · **ai:** no
- **implementation:** `strategic_goal` (GOAL), `key_result` (KR), `goal_link`; roll-ups in E15.

#### PRJ-009 · Portfolio planning and scenarios
- **name_fa:** برنامه‌ریزی سبد و تحلیل سناریو
- **group:** Portfolio and strategy
- **description:** A ranked investment backlog; selection under budget and capacity constraints; what-if scenarios (add, remove or shift items) comparing cost, capacity, value and risk; approval of a plan as a baseline; rebalancing reviews at planned intervals.
- **sources:** SN (portfolio planning, Alignment Planner scenarios and capacity vs demand); ITIL 4 (scenario planning, rebalancing); COBIT APO05; ISO 21504
- **tier:** P1 · **ai:** no
- **implementation:** `portfolio_scenario` snapshots; a constraint-check service; planning grid in E16; reviews via E08.

#### PRJ-010 · Roadmaps
- **name_fa:** نقشه راه
- **group:** Portfolio and strategy
- **description:** Timeline roadmaps of planning items, projects, releases and products with dependencies, milestones and confidence levels; shareable read-only views; agile roadmaps from epics.
- **sources:** SN (roadmaps, planning items); FS (agile project roadmap); ITIL 4 (portfolio roadmap)
- **tier:** P1 · **ai:** no
- **implementation:** E16 timeline over `planning_item` and linked records.

#### PRJ-011 · Portfolio health dashboards
- **name_fa:** داشبورد سلامت سبد
- **group:** Portfolio and strategy
- **description:** RAG roll-ups (schedule, cost, scope, resources), financial roll-ups, an at-risk list, demand-vs-capacity and alignment heat maps, milestone slip charts.
- **sources:** SN (portfolio health views); ITIL 4 (portfolio views, financial roll-ups, alignment heat map)
- **tier:** P1 · **ai:** no
- **implementation:** E15 dashboards over roll-up fields.

#### PRJ-012 · Investment funding and portfolio budgets
- **name_fa:** تأمین مالی سرمایه‌گذاری و بودجه سبد
- **group:** Portfolio and strategy
- **description:** Budgets per portfolio or product per fiscal period (Jalali fiscal year), funding sources, capex/opex split, allocations to programmes and projects, budget vs committed vs actual vs forecast, and budget change requests with approvals.
- **sources:** SN (investment funding to products or portfolios, portfolio budgets); COBIT APO05 (funding sources); ITIL 4
- **tier:** P1 · **ai:** no
- **implementation:** `portfolio_budget` lines linked to the `financial` module; field class `financial`.

#### PRJ-013 · Lean portfolio Kanban
- **name_fa:** کانبان سبد ناب
- **group:** Portfolio and strategy
- **description:** Portfolio epics flow through funnel → reviewing → analysing → ready → implementing → done with WIP limits and lean business cases; flow metrics per stage.
- **sources:** SAFe (Lean Portfolio Management); Kanban Method; Flow Framework; SN (SAFe portfolio)
- **tier:** P2 · **ai:** no
- **implementation:** E16 kanban with WIP limits over portfolio items.

#### PRJ-014 · Benefits register and realization
- **name_fa:** دفتر منافع و پیگیری تحقق آن
- **group:** Portfolio and strategy
- **description:** Benefits with owner, baseline, target, measurement method, linked KPI, expected realization date and actual values; dis-benefits; reviews scheduled after closure; realization % per project, programme and portfolio.
- **sources:** ITIL 4 (benefits register); COBIT EDM02, APO05; ISO 21503; PRINCE2 7 (benefits management approach)
- **tier:** P1 · **ai:** no
- **implementation:** `benefit` (prefix BEN) with measurement rows; planned-interval reviews via E08.

#### PRJ-015 · Project record
- **name_fa:** رکورد پروژه
- **group:** Planning and execution
- **description:** Number, name, code, type, methodology (predictive, agile, hybrid), charter (objectives, scope, out of scope, assumptions, constraints), sponsor, project manager, portfolio/programme, business unit, priority, state (Proposed → Approved → Planning → Executing → Closing → Closed; On hold; Cancelled), planned, actual and projected dates, estimated and actual hours and cost, schedule status (on schedule / delayed by n days / ahead by n days), RAG health, % complete, linked demand and benefits, attachments.
- **sources:** ITIL 4 (project records); ISO 21502; COBIT BAI11; SDP (projects: projected-on date, estimated/actual hours and cost, schedule status); SN (pm_project); FS; GLPI
- **tier:** P0 · **ai:** no
- **implementation:** `project` (prefix PRJ) on E01/E02; computed fields via E21 and E08.

#### PRJ-016 · Project templates and methodologies
- **name_fa:** الگوهای پروژه و روش‌شناسی‌ها
- **group:** Planning and execution
- **description:** Create a project blank, from a template or by saving an existing project as a template; templates hold phases, milestones, tasks, dependencies, deliverables, roles, gates, RAID starters and document lists; method packs for PRINCE2 7, PMBOK 8 performance domains, Scrum, Kanban and hybrid.
- **sources:** FS (project templates); SDP (Create Template from a project); SN (project templates); standards.md (PRINCE2 7, PMBOK 8, ISO 21502 methods)
- **tier:** P0 · **ai:** no
- **implementation:** E24 templates with snapshot instantiation.

#### PRJ-017 · Projects from ITSM records and automation
- **name_fa:** ایجاد پروژه از رکوردهای خدمات و خودکارسازی
- **group:** Planning and execution
- **description:** Create a project or project task from a demand, ticket, problem or change (e.g. a major change spawns a project); flows create projects and tasks on triggers; context and links are preserved.
- **sources:** FS (projects from a ticket, problem or change; Workflow Automator actions); SDP (project associations and automations)
- **tier:** P0 · **ai:** no
- **implementation:** E09 actions; `record_link(kind=originated_from)`.

#### PRJ-018 · WBS: phases, milestones and tasks
- **name_fa:** ساختار شکست کار: فازها، نقاط عطف و وظایف
- **group:** Planning and execution
- **description:** Phases or stages, milestones, tasks and sub-tasks forming the WBS; work packages; custom task types (epic, story, task, sub-task, milestone), statuses and fields per project; assignees, dates, priority, estimates, attachments, comments, @mentions, history and checklists; roll-up of effort, cost and % complete.
- **sources:** SDP (milestones and tasks forming the WBS); FS (configurable task types, statuses and fields); SN (project tasks, phases); ITIL 4; ISO 21502
- **tier:** P0 · **ai:** no
- **implementation:** `project_phase`, `milestone` (MS), `project_task` (prefix PTASK) with a parent tree; per-project schemas through metadata.

#### PRJ-019 · Dependencies and critical-path scheduling
- **name_fa:** وابستگی‌ها و زمان‌بندی مسیر بحرانی
- **group:** Planning and execution
- **description:** Finish-to-start, start-to-start, finish-to-finish and start-to-finish dependencies with lag or lead; automatic forward and backward scheduling over working calendars (Jalali, Iranian holidays, per-resource calendars); critical path and float; constraints (start no earlier than, must finish on); a preview of the impact before rescheduling.
- **sources:** SN (Gantt planning with critical path and auto-scheduling); ITIL 4 (FS/SS/FF/SF with lag, critical path); SDP (task relationships); FS (dependencies)
- **tier:** P0 · **ai:** no
- **implementation:** E21 CPM engine; `task_dependency(from_id, to_id, type, lag)`.

#### PRJ-020 · Gantt and timeline view
- **name_fa:** نمای گانت و خط زمانی
- **group:** Planning and execution
- **description:** Interactive, RTL-aware Gantt: drag to reschedule, link dependencies, reassign, change status, add work logs and comments from the bar; filters by member, milestone, task and status; baseline overlay; today line; a project overview map with milestone and task completion.
- **sources:** SDP (Gantt with row filters and actions, Project Overview Map); FS (Timeline view); SN (Project Workspace); Halo (Gantt in ticket, agent and project views); GLPI (project Gantt)
- **tier:** P0 · **ai:** no
- **implementation:** E16 Gantt backed by E21.

#### PRJ-021 · Multiple views of project work
- **name_fa:** نماهای چندگانه کار پروژه
- **group:** Planning and execution
- **description:** The same tasks as list, grouped list, Kanban board, calendar and timeline, with filters and saved personal and shared views.
- **sources:** FS (Timeline, Kanban, task list and grouped views); SDP (Kanban boards); GLPI (Kanban)
- **tier:** P0 · **ai:** no
- **implementation:** E16 view switcher over one query.

#### PRJ-022 · Baselines and variance
- **name_fa:** خط مبنا و انحراف
- **group:** Planning and execution
- **description:** Immutable baselines of schedule, effort and cost; current vs baseline comparison (dates, durations, cost); several baselines per project; resource plans lock in terminal states.
- **sources:** SN (baselines); ITIL 4 (baselines as immutable snapshots); Ivanti (resource plans locked when Completed or Closed)
- **tier:** P1 · **ai:** no
- **implementation:** `project_baseline(snapshot jsonb, taken_at, approved_by)`; variance computed on read.

#### PRJ-023 · Agile delivery: backlog, sprints and boards
- **name_fa:** تحویل چابک: بک‌لاگ، اسپرینت و بورد
- **group:** Planning and execution
- **description:** Epics, features, stories (story points, acceptance criteria), bugs, technical-debt items and spikes; backlog ranking (WSJF); sprints and sprint planning against team capacity; Scrum and Kanban boards with WIP limits; versions; velocity and burndown/burnup; a Definition of Done that includes operability items; hybrid projects roll agile items up into the WBS by points or % complete.
- **sources:** SN (Agile Development 2.0); FS (agile projects: roadmap, backlog, sprints, versions); ITIL 4 SDM/HVIT (backlog, WIP limits, Definition of Done)
- **tier:** P1 · **ai:** no
- **implementation:** `work_item` (types EPIC, FEAT, STRY, BUG, SPK), `sprint` (SPR); boards in E16.

#### PRJ-024 · Scaled agile (SAFe)
- **name_fa:** چابکی در مقیاس (SAFe)
- **group:** Planning and execution
- **description:** Agile release trains, program increments, PI planning boards with dependencies, features and portfolio epics.
- **sources:** SN (SAFe: ARTs, PI planning, portfolio epics); SAFe
- **tier:** P2 · **ai:** no
- **implementation:** Extensions of `work_item` and planning boards.

#### PRJ-025 · Deliverables and acceptance
- **name_fa:** تحویل‌دادنی‌ها و پذیرش آن‌ها
- **group:** Planning and execution
- **description:** Deliverables (products) with acceptance criteria, owner, due date, quality review and sign-off; linked to the releases and changes that put them into production.
- **sources:** ITIL 4 (deliverables); PRINCE2 7 (managing product delivery); ISO 21502
- **tier:** P1 · **ai:** no
- **implementation:** `deliverable` (prefix DLV) with E04 sign-off.

#### PRJ-026 · Project change control
- **name_fa:** کنترل تغییرات پروژه
- **group:** Planning and execution
- **description:** Project change requests for scope, time and cost (distinct from ITSM changes): impact on the baseline, options, decision by sponsor or board; approved requests update the baseline with history.
- **sources:** COBIT BAI11 (project change requests); ISO 21502; PMBOK
- **tier:** P1 · **ai:** no
- **implementation:** `project_change_request` (prefix PCR) with E04 approvals and baseline versioning.

#### PRJ-027 · Tolerances and exception management
- **name_fa:** حدود تحمل و مدیریت استثنا
- **group:** Planning and execution
- **description:** Tolerances for time, cost, scope, quality, risk and benefits per level (project, stage); a forecast breach raises an exception report and asks the board for an exception plan.
- **sources:** PRINCE2 7 (management by exception, exception plans)
- **tier:** P2 · **ai:** no
- **implementation:** E03 rules over forecasts; `exception_report` record.

#### PRJ-028 · Quality plan and quality register
- **name_fa:** طرح کیفیت و دفتر کیفیت
- **group:** Planning and execution
- **description:** Quality criteria and methods per deliverable and quality activities (reviews, tests) with results; links to test management.
- **sources:** COBIT BAI11 (quality plan); PRINCE2 7 (quality); ISO 21502
- **tier:** P2 · **ai:** no
- **implementation:** Checklist records linked to deliverables and test plans.

#### PRJ-029 · RAID log
- **name_fa:** دفتر ریسک‌ها، فرض‌ها، مسائل و تصمیم‌ها (RAID)
- **group:** Governance and control
- **description:** Risks (probability, impact, response, owner, trigger, review date), assumptions, issues, decisions, actions, dependencies and project-level changes in one log; risks above a threshold escalate to the enterprise risk register; items link to ITSM changes and problems.
- **sources:** ITIL 4 (RAID log); SN (RIDAC: risks, issues, decisions, actions, changes); COBIT BAI11.06; ISO 31000; standards.md
- **tier:** P0 · **ai:** no
- **implementation:** `raid_item(kind, …)` (prefix RAID) with an escalate action to the risk module.

#### PRJ-030 · Status reports
- **name_fa:** گزارش وضعیت پروژه
- **group:** Governance and control
- **description:** Periodic reports per project (weekly or biweekly): overall, schedule, cost, scope and resource RAG with comments, achievements, next steps, key risks and decisions needed; a frozen snapshot of key metrics for audit and trends; a distribution list; history.
- **sources:** SN (status reports with RAG per dimension); standards.md (status reports); ITIL 4
- **tier:** P0 · **ai:** no
- **implementation:** `status_report` (prefix PSR) snapshots; PDF via E23.

#### PRJ-031 · Health rules and at-risk alerts
- **name_fa:** قواعد سلامت و هشدار پروژه‌های در معرض خطر
- **group:** Governance and control
- **description:** Deterministic RAG thresholds (schedule variance, cost variance, overdue milestones, open high risks, overdue status report) compute project health; owner and sponsor are notified when a project becomes at risk or off track.
- **sources:** Ivanti (owner/sponsor e-mailed when a project is at risk or off track); SN; standards.md
- **tier:** P0 · **ai:** no
- **implementation:** E03 rules plus E11 notifications.

#### PRJ-032 · Linkage to ITSM records
- **name_fa:** پیوند پروژه با رکوردهای مدیریت خدمات
- **group:** Governance and control
- **description:** Incidents, requests, problems, changes, releases, CIs and assets link to projects and project tasks; deliverables enter production only through change and release; CAB sees the project context; project tasks link to changes and requirements.
- **sources:** FS (associate tickets, problems, changes and assets with projects); SDP (changes, incidents, releases with projects); ISO/IEC 20000-1 §8.5.2; ITIL 4; FitSM
- **tier:** P0 · **ai:** no
- **implementation:** `record_link` plus related panels on both sides.

#### PRJ-033 · Closure and lessons learned
- **name_fa:** بستن پروژه و درس‌آموخته‌ها
- **group:** Governance and control
- **description:** A closure checklist (deliverables accepted, contracts closed, resources released, documents archived), a closure report, a lessons-learned register that future projects can search, handover to operations and scheduled benefit reviews.
- **sources:** COBIT BAI11.09; ISO 21502; PRINCE2 7 (closing a project); SDP (closure rules)
- **tier:** P0 · **ai:** no
- **implementation:** Closure gate (E03) and `lesson_learned` (prefix LSN) indexed for retrieval (E19).

#### PRJ-034 · Stakeholder register and communication plan
- **name_fa:** دفتر ذی‌نفعان و برنامه ارتباطات
- **group:** Governance and control
- **description:** Stakeholders with influence, interest, attitude and an engagement plan; communication items (audience, message, channel, frequency, owner) with a schedule and tracking.
- **sources:** COBIT BAI11 (stakeholder register, communication plan); ITIL 4 OCM (stakeholder map); PMBOK 8 (stakeholders domain)
- **tier:** P1 · **ai:** no
- **implementation:** `stakeholder` and `comm_plan_item` (shared with CHG-059).

#### PRJ-035 · Organizational change management: impact, readiness and adoption
- **name_fa:** مدیریت تغییر سازمانی: اثر، آمادگی و پذیرش
- **group:** Governance and control
- **description:** Change impact assessment per group, ADKAR and Kotter templates, training plan, readiness and adoption surveys, adoption metrics (usage, proficiency), a resistance log and a champion network.
- **sources:** ITIL 4 (organizational change management); ITIL v5 (transformation toolbox: ADKAR, Kotter, stakeholder mapping)
- **tier:** P2 · **ai:** no
- **implementation:** E05 surveys plus `ocm_assessment` records.

#### PRJ-036 · Requirements management
- **name_fa:** مدیریت نیازمندی‌ها
- **group:** Governance and control
- **description:** Functional and non-functional requirements with MoSCoW priority, source, acceptance criteria, status and version; traceability to designs, tests (REL-027), deliverables and releases; volatility tracking; business-analysis templates (process models, gap analysis, user stories, use cases).
- **sources:** ITIL 4 (business analysis, requirements management); IT4IT (requirement objects); BABOK (complement)
- **tier:** P1 · **ai:** no
- **implementation:** `requirement` (prefix REQ) with version history and links.

#### PRJ-037 · Resource plans
- **name_fa:** برنامه منابع
- **group:** Resources, time and cost
- **description:** Requests for a role, group or named person in hours or FTE per period, with states Planning → Requested → Confirmed → Allocated (→ Completed or Closed, then locked); roll-up from phases to the project; confirmation by resource managers.
- **sources:** SN (resource plans with states planning → requested → confirmed → allocated); Ivanti (resource plans locked when Completed/Closed, roll-up from phases)
- **tier:** P1 · **ai:** no
- **implementation:** `resource_plan` (prefix RPL) and `resource_allocation(user_id, period, hours)`.

#### PRJ-038 · Capacity and allocation management
- **name_fa:** مدیریت ظرفیت و تخصیص منابع
- **group:** Resources, time and cost
- **description:** Capacity from work schedules and working calendars minus leave and business-as-usual load (tickets, on-call); allocation heat maps by person, group, role and skill; a resource finder by skill and availability; over- and under-allocation alerts; what-if. Resource managers see their people across projects; project managers see their own project.
- **sources:** SN (Resource Management Workspace, resource finder, over-allocation alerts); SDP (resource availability views); ITIL 4 (demand vs capacity); access.md (resource managers vs project managers)
- **tier:** P1 · **ai:** no
- **implementation:** Materialized view of allocation ÷ capacity per (resource, period); heat map in E16.

#### PRJ-039 · Timesheets and time tracking
- **name_fa:** برگه زمان و ثبت زمان کار
- **group:** Resources, time and cost
- **description:** Timers and time entries on project tasks, incidents, requests, changes and stories; weekly timesheets with policies (per day, per task), submission and approval, billable flag and rates that turn time into labour cost; feeds actual cost and earned value.
- **sources:** SN (time card management with policies and approvals); FS (time tracking and timesheets); SDP (project timesheets); ITIL 4 (effort and time tracking)
- **tier:** P0 · **ai:** no
- **implementation:** Shared `time_entry` and `timesheet` (prefix TS) with E04 approval; rates from `financial`; time entry and task updates available offline in the Windows replica (E22).

#### PRJ-040 · Project financials
- **name_fa:** امور مالی پروژه
- **group:** Resources, time and cost
- **description:** Cost plans and benefit plans per Jalali fiscal period (capex/opex), actuals from time entries and expense lines, purchase commitments, budget vs actual vs forecast, estimate at completion; currency in Rial/Toman with multi-currency support.
- **sources:** SN (cost plans and benefit plans, actuals from time cards and expense lines); ITIL 4 (budget vs actuals); COBIT
- **tier:** P1 · **ai:** no
- **implementation:** `cost_plan` and `benefit_plan` lines; expense lines from `financial`; field class `financial`.

#### PRJ-041 · Earned value management
- **name_fa:** مدیریت ارزش کسب‌شده
- **group:** Resources, time and cost
- **description:** BAC from the baseline, PV from the baseline schedule, EV from % complete or completed points, AC from time and costs; SV, CV, SPI, CPI, EAC, ETC, VAC and TCPI; milestone trend analysis; burn-up and burn-down; recomputed nightly.
- **sources:** ITIL 4 (earned value implementation notes); PMBOK; CMMI V3.0; standards.md (PV/EV/AC, SPI, CPI, forecast)
- **tier:** P1 · **ai:** no
- **implementation:** E08 nightly job; charts in E15.

#### PRJ-042 · Project collaboration
- **name_fa:** همکاری در پروژه
- **group:** Collaboration, access and integration
- **description:** Comments, @mentions and discussions per task, meeting records with minutes and actions, a versioned document library, two-way chat sync (Bale, Teams, Slack), notifications and digests; commits and pull requests linked to tasks via DevOps connectors.
- **sources:** FS (Slack two-way sync, GitHub/GitLab links); SN (project documents); SDP (comments)
- **tier:** P1 · **ai:** no
- **implementation:** E25 plus E12 bridges; documents as versioned attachments.

#### PRJ-043 · Project roles and membership
- **name_fa:** نقش‌ها و عضویت در پروژه
- **group:** Collaboration, access and integration
- **description:** Project manager, member, sponsor, PMO, resource manager, viewer and custom roles with fine-grained permissions; role swapping; project visibility open / limited / private; portfolio managers see their subtree; organizational association modes (unit only, with descendants, with ancestors, both).
- **sources:** FS (Project Manager and Project Member roles); SDP (predefined and custom project roles, role swapping); Jira (open/limited/private spaces); Clarity PPM (OBS association modes); Primavera P6 (OBS × EPS); access.md
- **tier:** P0 · **ai:** no
- **implementation:** E13 role-in-context with project and portfolio contexts (`pj:` and portfolio subtree keys).

#### PRJ-044 · Import, export and external PM integration
- **name_fa:** ورود و خروج داده و یکپارچگی با ابزارهای مدیریت پروژه
- **group:** Collaboration, access and integration
- **description:** Import projects, milestones and tasks from MS Project (.mpp/.xml), CSV and Excel; export to MS Project, Excel and PDF; sync with Jira, Azure DevOps and GitLab epics and issues.
- **sources:** SDP (import projects, milestones and tasks incl. .mpp); SN (Jira and Azure DevOps sync; MS Project import); BMC (PPM tools via iPaaS)
- **tier:** P1 · **ai:** no
- **implementation:** Importers plus E12 sync connectors.

#### PRJ-045 · Project dashboards and reports
- **name_fa:** داشبوردها و گزارش‌های پروژه
- **group:** Collaboration, access and integration
- **description:** Cross-project dashboards: progress, workload, overdue tasks, milestones due, schedule status, sprint burndown, budget burn and RAID counts; project-level reports; custom widgets.
- **sources:** FS (project analytics); SDP (project reports, dashboards, custom widgets)
- **tier:** P0 · **ai:** no
- **implementation:** E15 dashboards (see KPIs).

#### PRJ-046 · AI status report drafting
- **name_fa:** پیش‌نویس هوشمند گزارش وضعیت
- **group:** AI assistance
- **description:** Prefills health, an executive summary and the rationale from facts (schedule variance against baseline, cost actuals vs plan, over-allocation, open RAID items, milestones in the next two weeks). RAG colours stay deterministic; the AI draft is stored separately from the published report; a short "summarize" variant; formal Persian tone.
- **sources:** SN (Now Assist for SPM project status report, Australia); standards.md (status-report drafting); Atlassian Rovo (status updates)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skill grounded on PSR facts; separate draft and published fields.

#### PRJ-047 · AI RAID extraction from activity and meetings
- **name_fa:** استخراج هوشمند ریسک و مسئله از فعالیت‌ها و جلسات
- **group:** AI assistance
- **description:** A weekly scan of task comments, status notes, meeting minutes and chat summaries extracts candidate risks, issues, decisions and actions as AI drafts {title, cause, impact, probability, evidence link} for the project manager to confirm; meeting minutes become action items.
- **sources:** SN (Identify Project Risks via MCP for SPM, saved as AI drafts); standards.md (RAID extraction from meeting notes)
- **tier:** P1 · **ai:** yes
- **implementation:** Weekly E08 job with E17 extraction; drafts stored as `raid_item(status=ai_draft)`.

#### PRJ-048 · AI schedule and budget forecasting and monitoring agent
- **name_fa:** پیش‌بینی هوشمند تأخیر و هزینه و عامل پایش پروژه
- **group:** AI assistance
- **description:** Predicts schedule slip and budget overrun from progress patterns, velocity, resource conflicts and history; a monitoring agent watches tasks and flags stalls, missing updates and dependency risks.
- **sources:** standards.md (schedule-slip and budget-overrun prediction); SN (Monitor Project Tasks AI agents); Ivanti (rule-based at-risk notifications)
- **tier:** P1 · **ai:** yes
- **implementation:** E20 models plus an E18 agent with read tools and a notification tool.

#### PRJ-049 · AI story and acceptance-criteria generation
- **name_fa:** تولید داستان کاربر و معیار پذیرش با هوش مصنوعی
- **group:** AI assistance
- **description:** Generates user stories and acceptance criteria (Given/When/Then) from descriptions, requirements and demands; splits epics; proposes estimates.
- **sources:** SN (Now Assist for SPM user story and acceptance-criteria generation); Atlassian (Work item Planner)
- **tier:** P1 · **ai:** yes
- **implementation:** E17 skills with proposal-only writes.

#### PRJ-050 · Portfolio and project copilot
- **name_fa:** دستیار هوشمند سبد و پروژه
- **group:** AI assistance
- **description:** Natural-language questions over projects and portfolios ("which projects in the finance portfolio are at risk, and why?") answered from permission-filtered aggregates with links; MCP tools for external AI clients (get an AI status report, identify project risks).
- **sources:** SN (MCP for SPM: Get AI Status Report, Identify Project Risks); JSM/Rovo; analytics_ux (ACL-true AI analyst)
- **tier:** P1 · **ai:** yes
- **implementation:** E18 agent over the E15 semantic metric layer and E19 retrieval.

#### PRJ-051 · AI staffing recommendations
- **name_fa:** پیشنهاد هوشمند تأمین نیروی پروژه
- **group:** AI assistance
- **description:** Proposes people for resource requests by skills, availability, cost and development goals, and explains the trade-offs.
- **sources:** SN (resource finder by skill and availability, non-AI); ai.md (expertise vectors)
- **tier:** P2 · **ai:** yes
- **implementation:** E19 expertise vectors plus capacity data; proposal only.

### Data model

| Table | Prefix | Key fields |
|---|---|---|
| `idea`, `idea_vote` | IDEA | title, problem, benefit, category, submitter_id, votes, status, demand_id |
| `demand` | DMD | type, business_owner_id, sponsor_id, problem, objectives, alignment, est_capex, est_opex, est_effort_by_role, benefits, risk, score, portfolio_id, state, converted_to |
| `demand_assessment` | — | demand_id, questionnaire_version, respondent_id, answers, score |
| `business_case` | BC | demand_id/project_id, version, options, costs, benefits, npv, irr, payback, approved_at |
| `portfolio`, `program` | PFL / PGM | parent_id, owner_id, manager_id, strategy links, budget, health |
| `strategic_goal`, `key_result`, `goal_link` | GOAL / KR | period (Jalali FY/quarter), owner, target, current, links |
| `portfolio_scenario`, `portfolio_budget`, `planning_item` | — | snapshot of selected items; budget lines per fiscal period; roadmap items |
| `project` | PRJ | code, type, methodology, charter, sponsor_id, project_manager_id, portfolio_id, program_id, org_unit_id, priority, planned/actual/projected dates, est/actual hours and cost, schedule_status, health, pct_complete, demand_id, visibility, state |
| `project_phase`, `milestone`, `project_task` | — / MS / PTASK | project_id, parent_id, type, assignee, dates, estimate, actual, pct, status |
| `task_dependency` | — | from_id, to_id, type (FS/SS/FF/SF), lag |
| `project_baseline` | — | project_id, snapshot, taken_at, approved_by |
| `project_member` | — | project_id, user_id, role, valid_from, valid_to |
| `raid_item` | RAID | project_id, kind (risk/assumption/issue/decision/action/dependency/change), probability, impact, owner, due, status (incl. ai_draft), escalated_risk_id |
| `project_change_request` | PCR | project_id, scope/time/cost impact, decision, baseline_version |
| `exception_report` | EXR | project_id, stage, tolerance breached (time/cost/scope/quality/risk/benefit), forecast, options, board decision |
| `status_report` | PSR | project_id, period, RAG per dimension, narrative, ai_draft, snapshot metrics, published_at |
| `deliverable` | DLV | project_id, acceptance criteria, owner, due, accepted_at, release_id |
| `benefit` | BEN | owner, baseline, target, method, kpi_id, expected_at, actuals |
| `resource_plan`, `resource_allocation` | RPL | role/group/user, period, hours or FTE, state; user, period, hours |
| `time_entry`, `timesheet` | — / TS | record_type, record_id, user_id, date, hours, billable, rate; week, state |
| `cost_plan`, `benefit_plan` | — | project_id, fiscal period, capex/opex, amount, currency |
| `work_item`, `sprint` | EPIC/FEAT/STRY/BUG/SPK, SPR | type, parent, points, acceptance criteria, sprint_id, version, rank, status |
| `requirement` | REQ | project_id, type (functional/non-functional), MoSCoW, acceptance criteria, version, status |
| `stakeholder`, `comm_plan_item`, `ocm_assessment`, `lesson_learned` | — / — / — / LSN | influence, interest, plan; audience, channel, schedule; survey results; lesson, category, project |

**States**

| Record | States (category) |
|---|---|
| demand | Draft (new) → Submitted, Screening (waiting) → Qualified (active) → Approved (resolved) → Converted/Completed (closed); Deferred (waiting); Rejected (canceled) |
| project | Proposed (new) → Approved (waiting) → Planning, Executing (active) → Closing (resolved) → Closed (closed); On hold (waiting); Cancelled (canceled) |
| project_task / work_item | Open (new) → In progress (active) → Blocked (waiting) → Done (resolved/closed); Cancelled (canceled) |
| raid_item | AI draft / Open (new) → Active / Mitigating (active) → Monitoring (waiting) → Closed (closed); Rejected (canceled) |
| resource_plan | Planning (new) → Requested (waiting) → Confirmed (active) → Allocated (active) → Completed / Closed (closed, locked); Cancelled (canceled) |
| timesheet | Draft (new) → Submitted (waiting) → Approved (closed); Rejected (active again) |
| sprint | Planned (new) → Active (active) → Completed (closed) |

**Relationships:** portfolio 1–n programme/project/demand; programme 1–n project; demand 1–n project/change/epic (converted); project 1–n phase, milestone, task, RAID item, status report, deliverable, member, resource plan, baseline, PCR; task n–n task (dependency); project n–n incident/request/problem/change/release/CI (links); requirement n–n test case, release, deliverable; benefit n–1 project/programme; goal n–n demand/project/epic; time entry n–1 any work record.

**Access-scoping fields:** project = `project_id` (`pj:` keys on every project child); portfolio/programme = portfolio and programme ancestors (subtree keys for portfolio managers); owner = `project_manager_id`, `sponsor_id`; participant = `project_member` rows and approvers; unit = `org_unit_id` of the sponsoring unit; cost center = `cost_center_id`; resource pool = the resource manager's pool (sees allocations of their people across projects, not all project content); company/domain/workspace = `company_id`, `domain_id`, `workspace_id`; private projects add a restriction; financial fields (budgets, rates, costs) carry field class `financial`.

### KPIs

| KPI | Formula | Target / note |
|---|---|---|
| On-time delivery | projects closed by baseline finish (± tolerance) ÷ projects closed | trend up |
| On-budget delivery | projects with actual cost ≤ baseline budget (± tolerance) ÷ projects closed | trend up |
| Schedule variance / SPI | SV = EV − PV; SPI = EV ÷ PV | SPI ≈ 1 |
| Cost variance / CPI | CV = EV − AC; CPI = EV ÷ AC | CPI ≈ 1 |
| Estimate at completion | EAC = BAC ÷ CPI; ETC = EAC − AC; VAC = BAC − EAC; TCPI = (BAC − EV) ÷ (BAC − AC) | — |
| Milestone hit rate | milestones met by baseline date ÷ milestones due | — |
| Benefits realization | realized benefit value ÷ planned benefit value | — |
| Planned vs actual ROI | (realized benefits − actual cost) ÷ actual cost vs business-case ROI | — |
| Strategic alignment of spend | spend on items linked to strategic goals ÷ total portfolio spend | trend up |
| Resource utilization | actual (or allocated) hours ÷ capacity hours per period | 70–85% |
| Over-allocation | resources with allocation > capacity in period (count, %) | 0 |
| Demand lead time | median(approved_at − submitted_at); demand approval ratio = approved ÷ decided | — |
| Requirements volatility | requirements changed or added after baseline ÷ baseline requirements | low |
| Requirements traced to passing tests | requirements with passing tests ÷ requirements | 100% must-haves |
| Sprint say/do ratio | completed points ÷ committed points; velocity trend | ≈ 1 |
| Status-report timeliness | reports published by due date ÷ reports due | 100% |
| Adoption and readiness (OCM) | active users of the changed service ÷ target users; readiness survey score | — |
| Timesheet compliance | timesheets submitted on time ÷ timesheets due | ≥ 95% |

### Beyond the market
- **Jalali project calendar for real:** Gantt, baselines and EVM on the Jalali calendar with Iranian holidays (solar and lunar), Saturday–Wednesday working weeks with optional half-day Thursdays, Ramadan working hours and Jalali fiscal years for budgets; no PPM tool supports this natively.
- **Inflation-aware cost control:** cost baselines and EVM can be shown in nominal Rial/Toman and in real terms using an inflation index chosen by the tenant, so cost variance in a high-inflation economy is not misleading.
- **Local contract practice:** optional templates for Iranian public-sector and enterprise IT projects (terms of reference, contract milestones tied to progress-payment statements «صورت‌وضعیت», VAT on invoices), linked to milestones and deliverable acceptance.
- **Persian AI for project governance:** status reports, RAID extraction from meeting minutes «صورتجلسه» and voice notes from Bale/Telegram, user stories and portfolio Q&A in formal Persian, on the tenant's own model.
- **Offline planning in the Windows app:** project managers update schedules, timesheets and RAID logs offline and sync later; field teams log time without connectivity.
- **One backbone from idea to deployment:** idea → demand → project → requirement → release → change → deployed CI → benefit, with access control and AI on the same records, which no single vendor offers without separate products.

## Deliberately excluded

| Item (source) | Reason |
|---|---|
| DevOps Config — configuration data management and validation policies for application config (SN) | Deprecated by the vendor and cannot be newly activated; policy-as-code (DEV-010) covers the need. |
| Platform app-delivery pipelines for the ITSM's own customizations — update sets, AEMC pipelines, ATF and Instance Scan gates, Innovation Studio bundles, sandbox config sets (SN, BMC, FS, JSM) | Belongs to the `admin` module (promotion of tenant configuration between environments), not to change or release of customer services. |
| Hosting code, running CI/CD runners, artifact storage and static-analysis engines as products (SonarQube-, Artifactory-, Jenkins-like) | Outside ITSM scope; we integrate (DEV-001, DEV-003, REL-023) and keep only light AI review (DEV-025). |
| A feature-flag service of our own (LaunchDarkly-like) | We track flags and released state (REL-024) from existing flag services instead of serving flags. |
| A test-automation execution engine | We manage tests and ingest automated results (REL-027); executing tests is the CI's job. |
| Full app-generation agents (SN Build Agent, Autonomous Engineer) | Platform/low-code concern; only fix-PR proposals for services in scope (DEV-026) are kept. |
| SLO/SLI definitions, error-budget computation and burn-rate alerting | Owned by `slm` and `event`; consumed by CHG-035 and DEV-018. |
| Blameless post-incident reviews, incident command center, postmortem drafting | Owned by `incident`/`problem`; change PIR (CHG-053) covers changes only. |
| Toil tracking and team skills matrices | Owned by `workforce`; used by DEV-018 and PRJ-038. |
| Application/technology portfolio, enterprise architecture, service demand and capacity (ISO/IEC 20000-1 §8.4.2) | Owned by `service_portfolio` (and capacity); project portfolio here covers investments and delivery. |
| Cost models, chargeback, expense-line ingestion, general budgets | Owned by `financial`; project financials (PRJ-040) reference them. |
| Automatic resource levelling and Monte Carlo schedule-risk simulation (MS Project/Primavera class) | Rarely needed for IT projects in an ITSM; critical path, baselines and AI slip prediction (PRJ-019, PRJ-022, PRJ-048) are enough for v1. |
| Enterprise agile planning at Jira Align scale (beyond SAFe basics in PRJ-024) | Specialized product category with low demand among target customers. |
| PSA billing and invoicing of project time to customers (Halo PSA style) | Belongs to `csm`/`financial` for MSP tenants, not to internal project management. |
| Construction/engineering project specifics (BIM, quantity surveying) | Irrelevant for an ITSM product. |
| Vendor licence-driven features (e.g. "approvers without licences", project-only licences) | Licensing artefacts of other vendors; our approver persona and audiences give the same capability. |
| HIPAA-specific change fields | Not applicable to the target market; the generic compliance-field mechanism (CHG-058) handles any regime a tenant loads. |
| Centralized Jira-wide incident/change views (JSM 2026) | A product-packaging feature of Atlassian; our cross-workspace lists and calendars already cover it. |

## Engine requirements

Shared platform capabilities these modules depend on (referenced as E-codes in the implementation notes).

| Code | Capability | What these modules need from it |
|---|---|---|
| E01 | Record engine | Metadata tables and fields, numbering prefixes (CHG, CTASK, REL, DEP, PRJ…), typed many-to-many `record_link` with cardinality, activity stream and work notes, attachments, generated REST API, custom fields per tenant. |
| E02 | State-model engine | Versioned process models per record type and per model (snapshot per record), two-level stage → status, state categories (new/active/waiting/resolved/closed/canceled), transitions with conditions and rights, state field policies (mandatory/read-only/hidden), status reasons, automatic transitions, re-entry rules, lifecycle bar data. |
| E03 | Condition and decision engine | One condition AST for rules, gates, windows, policies and audiences; decision tables (first match / all matches, dependent decisions); scoring (weighted rules, questionnaires, bands, combination: max, highest severity, weighted average); formula fields; policy-as-code compilation. |
| E04 | Approval engine | Approval plans from policies, groups, chains, levels and thresholds, quorum and deadlines, dynamic approver resolvers, delegation, SoD checks at resolution and vote, e-signature and step-up, reminders and escalation, waivers, multi-channel actionable approvals. |
| E05 | Questionnaire and survey engine | Question types, weights, branching, multilingual text, versioning, AI-drafted questionnaires (risk, demand assessment, OCM readiness). |
| E06 | Calendar and schedule service | Jalali, Gregorian and Hijri calendars; Iranian official holiday feed (solar and lunar); business calendars; RRULE windows with time zones and exclusions; interval-overlap index; server-side expansion per range; iCal feeds; Exchange/Google/CalDAV sync. |
| E07 | CMDB graph service | Direction-aware impact traversal with depth and weights, blast radius, impacted services/customers/SLAs, n-hop neighbourhoods, CI timelines, service-graph UI data. |
| E08 | Jobs and scheduler | Async workers (conflict detection, risk recompute, roll-ups), cron jobs (daily success scores, nightly EVM, DORA aggregation, weekly AI scans), planned-interval reviews, recurring record generators, continuation for long batches. |
| E09 | Flow designer and automation | Triggers (record events, schedules, inbound webhooks, external DevOps events), actions, timers, fork/join, approvals, sandboxed scripts, webhooks, error paths, execution log on the record, AI-drafted flows. |
| E10 | SLA/OLA timers | Timers on records and approvals with business calendars, pause conditions, multi-level escalation. |
| E11 | Notifications and messaging | E-mail, in-app, push (web, mobile, Windows), SMS gateways, Bale/Eitaa/Telegram/Rubika bots, Teams/Slack; Persian templates; signed action links; digests; scheduled sends. |
| E12 | Integration hub | Signed inbound webhooks, normalized event store, outbound webhooks, connectors (git hosts, CI/CD, trackers, registries, flag services, calendars, status page, endpoint management), polling/callback protocols (change gate), bi-directional sync with field mapping and ownership (e-bonding), machine identities with scoped tokens. |
| E13 | Access control | Role-in-context, scopes and `acl_keys`, time-boxed shares (CAB, participant), dynamic and static SoD rules, just-in-time elevation, step-up MFA per action class, field classes (`financial`, `dev`), restrictions and security levels, option and transition rules. |
| E14 | Audit and evidence | Append-only hash-chained audit and privileged-action log, immutable evidence snapshots (change receipts), requirement/control library with crosswalks, complete-population exports with read audit. |
| E15 | Analytics | Metric library with versioned formulas, snapshots, Jalali periods, dashboards and report packs, scheduled distribution, calibration charts, matrix views, process mining (later). |
| E16 | UI kit | Lists with saved filters and bulk actions, forms with side panels, kanban with WIP limits, virtualized calendar/timeline, RTL Gantt with dependencies and critical path, heat maps, bubble charts, meeting/workbench mode, lifecycle bar, accessibility (keyboard, 400% reflow, patterns not colour only). |
| E17 | AI skills layer | Skill registry (summarize, explain, draft, classify, extract, answer questionnaires, generate test cases and release notes) on the tenant's chosen cloud or local model; grounding only on supplied facts with citations; Persian output and tone control; proposal-only writes; AI artefact storage; run logs, cost metering and kill switch. |
| E18 | AI agents and MCP | Agent runtime whose tools are API operations, run-as-user or agent principal, confirmation/approval for risky tools, coder-agent dispatch to tenant CI runners, MCP server with per-user revocable tokens. |
| E19 | Retrieval and similarity | Embeddings plus hybrid search over records with ACL keys (early and late binding), similar-record APIs, expertise vectors, duplicate detection. |
| E20 | ML pipeline | Per-tenant feature extraction, training (logistic regression, GBM), calibration, model registry with versions and model cards, explanations (top factors/SHAP), drift monitoring, approval before activation. |
| E21 | Project scheduling engine | CPM forward/backward pass over working calendars, dependency types and lags, constraints, baselines, roll-ups of effort, cost and % complete, release-dependency propagation. |
| E22 | Offline sync (Windows replica) | Access-key buckets for change records, runbooks, calendars, windows, project plans and timesheets; offline action queue with conflict resolution; policy limits on offline actions (approvals online-only). |
| E23 | Document generation | RTL PDF/DOCX for CAB minutes, risk reports, status reports, review packs and audit exports, with Jalali dates. |
| E24 | Template and catalog engine | Versioned templates with approval, snapshot instantiation, publication of standard changes and golden paths to the portal catalogue. |
| E25 | Collaboration | Conversation threads on records, mentions, swarm rooms, meeting objects, external chat bridges with sync-back. |
