# Knowledge management and AI (generative, predictive, conversational, agentic, RAG, governance)

> Group g5 · modules `knowledge` and `ai` · consolidated and de-duplicated from the research reports itil, standards, servicenow, jsm, freshservice, bmc_manageengine, others, ai, access and analytics_ux (snapshot 2026-11-07).
>
> **Conventions.** IDs are `KB-nnn` (knowledge) and `AI-nnn` (AI). **Tier**: P0 = must have for an enterprise ITSM v1; P1 = strong differentiator to build next; P2 = later or optional. **AI: yes** means the feature calls an ML/LLM model or is part of the AI runtime (gateway, retrieval, guardrails, metering). **Sources** list every tool or framework that has the capability; duplicates under different vendor names are merged into one feature. Vendor facts the research marked "unverified" stay unverified here.
>
> **Feature layout.** First line: tier · AI · sources. **What/how**: behaviour, fields, states, rules and UI. **Build**: record tables and fields, plus the engine capabilities used (conditions, states, SLA, approvals, notifications, flows, jobs, RAG, AI skill/agent, special UI). AI features also carry **Family** (capability family) and **Modules** (where the capability appears).
>
> **Non-negotiable rule for both modules.** Every list, search, answer, summary, report, export, notification, sync bucket and AI retrieval runs under the asking user's permissions through one policy compiler (access keys + record evaluator). AI never exceeds the user it acts for: `allowed = user_can ∩ agent_tools_allow ∩ ai_channel_allows`.

## Module: knowledge — مدیریت دانش

Knowledge management keeps the organisation's know-how accurate, findable and reused: knowledge bases, articles, snippets, decision trees and a governed document library ("smart documents"), with KCS-style capture in the flow of work, audience-based access, Persian-aware search, deflection, quality control and AI curation. It is the main grounding source for every AI answer in the product, so its access and AI-use rules are part of the security model.

### Features

#### A. Content model and structure

**KB-001 · Knowledge bases (multiple, owned, with workflows)** — پایگاه‌های دانش چندگانه
- P0 · AI: no · Sources: ServiceNow (`kb_knowledge_base`), JSM (linked Confluence spaces; internal vs external KB), Freshservice (per-workspace solutions), BMC Helix KM / KM by ComAround / IS KM, ManageEngine SDP Solutions, GLPI; ISO/IEC 20000-1 §7.6; COBIT 2019 BAI08.
- What/how: Any number of bases per workspace, department or audience (IT, HR, known errors, customer-facing, field service, runbooks). A base has an owner, managers, a kind (internal = agents only; external = requesters, customers or public), default audience, publish workflow (instant or approval), retire workflow (instant or approval), allowed templates, default validity in days, versioning on/off, KCS on/off, languages, and switches for comments, ratings, suggestions, category editing and AI use.
- Build: `kb_base`; publish/retire flows bound per base from the workflow engine; audience bindings; base-level AI policy (KB-034); settings JSON.

**KB-002 · Category and folder tree** — درخت دسته‌بندی و پوشه‌ها
- P0 · AI: no · Sources: Freshservice (category → folder → sub-folder; `manage_by_group_ids`; system folders such as Drafts), ServiceNow (`kb_category`), JSM (≤30 categories per space, featured articles, drag-to-reorder), ManageEngine SDP (topic hierarchy).
- What/how: Hierarchical categories inside a base with drag-to-reorder, icons, featured (pinned) articles, an optional narrowing audience per node, and "managed by" groups that may edit content below the node. Drafts and Archived are virtual views, not folders.
- Build: `kb_category(parent_id, path, sort, featured_article_ids, managed_by_group_ids)`; closure table; audience bindings per node, inherited by articles as access keys.

**KB-003 · Article record and metadata** — رکورد مقاله و فراداده
- P0 · AI: no · Sources: all tools; ITIL 4 Knowledge Management practice; KCS v6 T5.1.
- What/how: A stable article numbered `KB-nnnnnn` with title, summary (portal card), body, type, template, base, category, tags, keywords (search boost), linked services/offerings/CIs/catalog items/products and versions, language, author, owner, ownership group, reviewers, version, lifecycle state, KCS confidence/audience/governance, valid-from, valid-to, next review date, classification, card image and attachments. System counters: views, reuse (distinct linked records), helpful yes/no, rating, open flags, AI citations; a replaced-by pointer. Articles never hold requester-specific data (names, contacts, entitlements), which stays in the case.
- Build: `kb_article` + `kb_article_version` (see Data model); `kb_article_ref` for CI/service/catalog/product links; counters fed by the knowledge event stream (KB-064), reuse counted from links, not page views.

**KB-004 · Article types and structured templates** — انواع مقاله و قالب‌های ساخت‌یافته
- P0 · AI: no · Sources: ServiceNow (How-to, FAQ, KCS, Known error, "What is"; custom templates), BMC Helix (How To, Problem Solution, Known Error, Reference, Decision Tree, KCS), JSM (seven built-in templates), ITIL (policy, reference, release note, decision record), KCS v6 (Issue / Environment / Resolution / Cause / Cause test).
- What/how: A template is an ordered list of sections, each with label, guidance text, required flag and field class (public or internal). Built-ins: How-to, FAQ, Troubleshooting, KCS, Known error (symptom, cause, workaround, fix status), Policy/regulation/circular, Reference, Release note, Decision record, Runbook/SOP (when to use, numbered steps with conditions, exact field/status changes, canned replies) and Decision tree. The editor has a template picker; templates are allowed per base; each template can carry its own AI drafting skill (ServiceNow clones the generative skill per template).
- Build: `kb_template(sections JSON schema, allowed_base_ids, ai_skill_id)`; sections stored as structured JSON in the version; one renderer per channel (portal, agent panel, chat, messenger, PDF).

**KB-005 · Internal-only sections** — بخش‌های فقط-داخلی
- P0 · AI: no · Sources: KCS v6 T5.1 (Internal Resolution field hidden from requesters even on external articles), ServiceNow (knowledge blocks with user criteria), JSM (Confluence page restrictions, padlock shown to agents).
- What/how: Any section can be marked internal. External personas never receive it: it is not only hidden in the UI but excluded from the payload, search snippets, exports and AI answers for requesters. Agents see a lock badge. This removes the KCS fallback of keeping a separate "internal use only" companion article.
- Build: field class `internal` per section; projection and separate index partition (internal chunks carry stricter keys); render-time re-check.

**KB-006 · Reusable knowledge blocks** — بلوک‌های دانش قابل‌استفاده‌مجدد
- P1 · AI: no · Sources: ServiceNow (knowledge blocks with their own user criteria; searchable and insertable from the Knowledge Center editor since March 2026).
- What/how: Fragments such as "download the VPN client" or a contact table, embedded by reference in many articles. Each block has its own audience, so one article shows different sections to different readers. Publishing a block updates every host article; a usage list shows where it is embedded.
- Build: versioned `kb_block`; `kb_block_usage(article_version_id, block_id)`; renderer resolves blocks per viewer; job re-indexes host articles when a block is published.

**KB-007 · Answer snippets and Q&A sets** — پاسخ‌های کوتاه و مجموعه‌های پرسش‌وپاسخ
- P1 · AI: no · Sources: InvGate (Knowledge Snippets feeding instant answers with source links), SysAid (Q&A Sets in the Copilot Data Pool, "Monitor & Fine-Tune"), Zendesk.
- What/how: Short question → answer units (one fact in 1–3 sentences) kept beside full articles, each with a source link, audience, language and validity. They are preferred grounding for short questions in the portal, chat and messengers; owners validate and retire them like articles.
- Build: `kb_snippet(question, answer, source_ref, audience, language, state, valid_to)`; indexed as first-class retrieval units with access keys.

**KB-008 · External link articles** — مقاله‌های پیوندی
- P2 · AI: no · Sources: Freshservice (external URL articles).
- What/how: Link-only articles that point to an intranet or external URL, with summary and keywords so they appear in browse and search. The target page can be crawled for retrieval when the web connector is enabled.
- Build: article type `link`; optional web source in `kb_connector_source`.

**KB-009 · Rich bidirectional editor** — ویرایشگر غنی دوجهته
- P0 · AI: no · Sources: ServiceNow (rich markdown editor and markdown code editor, Oct 2026), BMC Helix (Froala), JSM (Confluence live docs), Freshservice.
- What/how: WYSIWYG and Markdown modes; headings, tables, callouts, collapsible sections, code blocks with syntax highlighting and a copy button, pasted or uploaded images, embedded video, internal-section toggle, block and template insertion, links to records and articles, accessibility checks (alt text, heading order). Mixed RTL/LTR paragraphs are bidi-safe (`dir=auto` per block); Persian typography keeps the zero-width non-joiner (half-space); paste from Word is cleaned.
- Build: block-based document JSON exportable to HTML/Markdown/PDF; HTML sanitiser; shared editor component reused by other modules.

**KB-010 · Attachments and media** — پیوست‌ها و رسانه
- P0 · AI: no · Sources: Freshservice (attachments up to 40 MB), ManageEngine Solution Assist (indexes PDF, DOCX, DOC, MD, TXT, HTML attachments so excerpts can be quoted), ServiceNow.
- What/how: Files attached to articles get a virus scan, size limits and a preview. Their text is extracted and indexed with the article's audience, so search and AI answers can quote attachments.
- Build: file store plus the extraction pipeline of KB-012; attachment chunks inherit the article's keys.

**KB-011 · Decision trees and guided self-help** — درخت تصمیم و خودیاری هدایت‌شده
- P1 · AI: no · Sources: EasyVista Guided Self Help ("procedures": question → branch → answer or action; node-based model in 2025.3), BMC Helix (Decision Tree template).
- What/how: A graph of questions, branches and outcomes (show an answer, open a pre-filled request, run a self-service action, show an article), used in the portal and by agents on calls. Analytics show drop-off per node. The assistant can walk a tree inside a chat.
- Build: `kb_decision_tree(nodes JSON)` edited with the workflow graph editor; node actions call catalog items and flows; events logged per node.

**KB-012 · Document library ("smart documents")** — کتابخانه اسناد هوشمند
- P0 · AI: yes · Sources: BMC Helix Business Workflows (document library with read access), SysAid (Data Pool: Documents and URLs), Freshservice (uploaded files and URLs for the AI Agent), InvGate (DOC/DOCX/PDF knowledge), ServiceNow (document Q&A workflow, Vision AI Agent, attachment summarisation), JSM (Create with Rovo accepts PDFs), ManageEngine (Solution Assist over attachments).
- What/how: Governed files (policies, circulars, regulations, manuals, vendor guides, contracts, SOPs, scanned letters) uploaded into collections: workspace, shared or personal. Each document is numbered `DOC-nnnnnn` and has owner, audience, classification, language, version, valid-to/review date, AI policy and extraction status. Pipeline: virus scan → text extraction (PDF, DOCX, XLSX, PPTX, HTML, MD, TXT, images) → Persian/English OCR for scans → structure-aware chunking that keeps page numbers → embeddings → hybrid index. The viewer jumps to the cited page; a new upload creates a new version with history; a document can be promoted to an article. Questions over documents are answered by AI-122.
- Build: `doc_collection`, `doc_document`, `doc_version`; extraction jobs (system lane) and embedding jobs (llm lane); chunks with access keys and page refs; registered as a RAG source.

#### B. Authoring

**KB-013 · Create an article from a record** — ساخت مقاله از روی رکورد
- P0 · AI: no (AI drafting is KB-066) · Sources: ServiceNow (incident Knowledge checkbox and UI action; article interceptor page), JSM ("create article from request"), Freshservice, ManageEngine SDP, BMC Helix; KCS Solve Loop (capture in the moment, in the requester's context).
- What/how: From an incident, request, problem, case or work order, "Create article" opens the editor pre-filled: issue = short description in the requester's words, environment = CI, service and product versions, resolution = resolution notes, cause = cause code. Requester data is stripped. The article is linked as `created_from` and counts as a create event. Ticking "Knowledge" on resolve creates a follow-up task when the agent defers writing.
- Build: per-record-type field mapping `kb_capture_map`; `kb_link(link_type=created_from)`; optional `kb_task` on resolve.

**KB-014 · Drafts, autosave and review collaboration** — پیش‌نویس، ذخیره خودکار و همکاری در بازبینی
- P1 · AI: no · Sources: JSM (Confluence live docs), ServiceNow (one draft per article), Freshservice (send feedback to author).
- What/how: Drafts autosave; reviewers leave inline comments and @mentions; suggestion mode lets others propose edits that the owner accepts; co-editor presence; an edit lock or merge on concurrent edits; "send to SME" creates a review request.
- Build: draft = version row in state `draft`; `kb_comment(version_id, anchor, body, resolved)`; CRDT co-editing is optional later.

**KB-015 · Versioning, diff and restore** — نسخه‌بندی، مقایسه و بازگردانی
- P0 · AI: no · Sources: ServiceNow (major/minor versions, one draft at a time, Outdated state, author/version banner), Freshservice (version history and restore; diffs only through a marketplace app; old approval metadata not shown), ManageEngine SDP (solution history), ITIL.
- What/how: Editing a published article creates a draft version. Publishing swaps the published pointer atomically and marks the previous version Outdated. Authors choose minor edit or new major version. Side-by-side diff; any version can be restored as a new draft; the article shows author, version and last-reviewed date; approval and publisher metadata are kept on every version.
- Build: `kb_article_version`; `published_version_id` and `draft_version_id` pointers; search and RAG index only the published version per language.

**KB-016 · Trash and restore** — سطل بازیافت و بازگردانی
- P1 · AI: no · Sources: Freshservice (restore, bulk restore, delete forever, Mar 2026), ManageEngine SDP (30-day restore).
- What/how: Deleted bases, categories, articles and documents stay in trash for N days (default 30) with restore and bulk restore; permanent delete is a separate permission; legal hold blocks purge. Chunks leave the AI index at deletion time, not at purge time.
- Build: soft-delete column and retention job; index removal event.

**KB-017 · Import, migration and legacy content** — درون‌ریزی و مهاجرت محتوا
- P1 · AI: yes (optional restructuring) · Sources: KCS v6 T5.6 (legacy-data import), BMC (migration path to IS KM), JSM/Confluence, Freshservice Solutions API.
- What/how: Bulk import from Word, HTML, Markdown, CSV, Confluence, SharePoint pages and other ITSM knowledge bases. A mapping wizard sets category, audience, owner and language. Optional AI restructuring converts free text into KCS or How-to templates as drafts. Duplicates are checked on import (KB-073) and an import report lists failures.
- Build: import jobs; skill `kb.restructure`; duplicate detection reuse.

#### C. Lifecycle, governance and KCS

**KB-018 · Article lifecycle** — چرخه عمر مقاله
- P0 · AI: no · Sources: ServiceNow (Draft → Review → Published → Pending retirement → Retired, plus Outdated), BMC Helix (Draft → SME Review → Publish Approval → Published → Retire Approval → Retired, plus Closed/Cancelled), Freshservice (draft/published + approval status), ITIL.
- What/how: A configurable state machine per base: Draft → In review → Approved/Scheduled → Published → Pending retirement → Retired, with Outdated for superseded versions and Rejected/Cancelled. Transition guards check role or KCS licence. Publish and retire can be scheduled. Retired articles leave search and browse but stay readable from linked records and through advanced search, and can be restored.
- Build: workflow-engine state machine with transition rules; scheduled jobs; state categories in the Data model.

**KB-019 · Publish approval** — تأیید انتشار
- P0 · AI: no · Sources: Freshservice (folder-level approvers, "All approvers" or "Anyone can approve/reject", `send_for_approval`, approve/reject/send feedback), ServiceNow (publish workflow), ManageEngine SDP (Approve Solutions permission), BMC Helix; access.md (author ≠ publisher SoD option).
- What/how: Approval policy per base or category: approvers (users, groups, owner group, SME per category), mode (all, any, majority), reminders and escalation. The approver approves, rejects, or returns with feedback; the author revises and resubmits. Optional separation of duties (author ≠ publisher). Compliance-based content requires designated approvers. Approvals work from e-mail, messengers and mobile.
- Build: approval engine bound to the transition; SoD rule; notifications.

**KB-020 · Retirement and replacement** — بازنشستگی و جایگزینی
- P0 · AI: no · Sources: ServiceNow (instant or approval-based retirement; flows in Workflow Studio since Zurich), KCS v6 T5.5 (archiving), Freshservice.
- What/how: Retire now, on a date or through approval, with a mandatory reason. An optional "replaced by" article redirects readers and re-points future suggestions. Linked records keep read-only access to the retired version. Chunks leave the RAG index immediately.
- Build: transition plus `replaced_by_article_id`; portal redirect; index removal event.

**KB-021 · Review dates and expiry** — بازبینی دوره‌ای و انقضا
- P0 · AI: no · Sources: ServiceNow (valid-to, expiry notifications, scheduled retirement, republish), Freshservice (review date reminder; reported revert to draft), ManageEngine SDP (review/expiry notification rules), BMC Helix; ISO/IEC 20000-1 §7.5.
- What/how: Valid-to and next-review dates default from the base and use the Jalali calendar. Owners get reminders N days before. When due, the system creates a review task and, per base policy, shows a "may be outdated" banner, unpublishes, or reverts to draft. A review is one click: confirm, update or retire. Review history is kept.
- Build: planned-interval engine (`kb_task kind=review`); daily job; notifications; per-base policy.

**KB-022 · KCS article state (confidence, audience, governance)** — وضعیت KCS: اعتماد، مخاطب و حاکمیت
- P1 · AI: no · Sources: KCS v6 T5.2 (Work in Progress, Not Validated, Validated, Archived; audiences Internal, Within a Domain, Partners, Customers, Public; experience- vs compliance-based governance; Article State Matrix), ServiceNow (KCS confidence), BMC Helix.
- What/how: Three fields beside the lifecycle. The Article State Matrix (audience × confidence × knowledge domain) decides visibility, e.g. partners and customers see only Validated articles. Compliance-based articles are editable only by designated people; everyone can comment.
- Build: columns on `kb_article`; matrix compiled into audience keys; transition guards.

**KB-023 · WIP articles ("searching is creating")** — مقاله در حال کار («جست‌وجو یعنی ساختن»)
- P1 · AI: yes (optional framing of the issue) · Sources: KCS v6 T1.3 and T5.2.
- What/how: When an agent searches from a record and finds nothing, the search text becomes a WIP article linked to the record. WIPs stay searchable to stop duplicate work. At closure the WIP is deleted if an existing article solved the issue, completed to Not Validated or Validated if the issue was resolved, and deleted or archived if unresolved (unless it holds reusable information).
- Build: `kb_article(state=wip, source_record_ref)`; closure hook on the record's resolve transition.

**KB-024 · KCS licences and roles** — مجوزها و نقش‌های KCS
- P1 · AI: no · Sources: KCS v6 T7.1 and Appendix D (Candidate, Contributor, Publisher, Coach, Knowledge Domain Expert, KCS Council), ServiceNow, BMC Helix (role names unverified).
- What/how: A licence per user and knowledge domain. Candidate drafts and edits own articles and needs coach review; Contributor creates and validates internal content; Publisher sets external audiences; Coach reviews candidates; the KDE owns domain health. Licences come from training, checklist results and coach recommendation, are renewed periodically and can be revoked. Transition guards check the licence, not the ITSM role, and licences are not tied to job grade.
- Build: `kcs_licence(user_id, level, domain_id, granted_at, expires_at, revoked_at, evidence)`; guard functions; renewal reminders.

**KB-025 · Publishing models (just-in-time, 90/0, conveyor belt)** — مدل‌های انتشار: به‌موقع، ۹۰/۰، نوار نقاله
- P1 · AI: no · Sources: KCS v6 T5.2.
- What/how: Per base: just-in-time publishing by licensed staff; automatic external publication after N reuses; or the conveyor belt (external after three internal reuses unless someone intervenes within five days). The 90/0 target (90% of articles external at or before case closure) is tracked.
- Build: rules on the reuse counter; scheduled job; 90/0 metric.

**KB-026 · Controlled documents, policies and read-acknowledge** — اسناد کنترل‌شده، خط‌مشی‌ها و تأیید مطالعه
- P1 · AI: no · Sources: ISO/IEC 20000-1 §7.5, ISO/IEC 27001 §7.5, KCS compliance-based governance, ITIL.
- What/how: Compliance-based articles and documents (policies, circulars, regulations) carry document number, issuing authority, effective date, approval record, distribution audience, mandatory review interval and version history. "Read and acknowledge" campaigns have due dates, reminders and per-user acknowledgement records. Supersession chains show which circular replaced which.
- Build: `governance=compliance`; `kb_attestation(version_id, audience_id, due_at)` and `kb_attestation_ack(user_id, at)`; planned-interval engine; reports.

**KB-027 · Ownership and ownership groups** — مالکیت و گروه مالک
- P0 · AI: no · Sources: ServiceNow (ownership group members read, modify, approve and retire their articles), Freshservice (managed-by groups), access.md.
- What/how: Every article has an owner and an owner group responsible for accuracy. Flags and review tasks route to them; members can edit, approve and retire within their scope. When an owner is deactivated, a bulk re-own tool reassigns their articles.
- Build: `owner_id`, `owner_group_id` produce the contribute keys; deactivation hook creates a re-own task.

**KB-028 · Knowledge domains and knowledge routines** — حوزه‌های دانش و روال‌های دانشی
- P1 · AI: no · Sources: ITIL v5 Knowledge Management practice (knowledge domain, knowledge routine), KCS (Knowledge Domain Expert; T5.7 priming content for new products).
- What/how: Domains (e.g. "Network", "Payroll") map to categories and services and have a KDE owner. Routines are scheduled or event rules with compliance tracking: "every resolved P1 has a reviewed article within 5 days", "quarterly review of known-error articles", "prime articles before a new service launches", "translate the top 50 articles monthly". A dashboard shows routine compliance.
- Build: `kb_domain`, `kb_routine(condition AST, schedule, target_days)`; rule engine and planned-interval engine; SLA timers on generated tasks.

**KB-029 · KM governance records (ISO 30401, SECI)** — سوابق حاکمیت مدیریت دانش
- P2 · AI: no · Sources: ISO 30401:2018, COBIT 2019 BAI08.01–08.04, ITIL 4 Knowledge Management (KM environment, SECI, absorptive capacity).
- What/how: Records of the KM approach and guidelines, KM objectives, stakeholders, classified knowledge sources, an enabler assessment (people, processes, technology, governance, culture) and periodic KM reviews, kept as audit evidence.
- Build: management-system kernel records tagged `iso30401`, linked to KM metrics.

#### D. Access and audiences

**KB-030 · Audience-based read and contribute rights** — دسترسی خواندن و مشارکت بر پایه مخاطب
- P0 · AI: no · Sources: ServiceNow (user criteria Can/Cannot Read and Can/Cannot Contribute, deny wins), Freshservice (folder visibility: all, logged-in, agents, departments, agent groups, requester groups, MSP clients), JSM ("who can view" per linked space), GLPI (targets to users, groups, profiles, entities with recursion), BMC Helix (company field); access.md audiences.
- What/how: Bindings at base, category, article and block level: `can_read`, `cannot_read`, `can_contribute`, `cannot_contribute`. Read = (can_read ∪ contributors) − cannot_read; deny always wins; lower levels only narrow unless the tenant enables "article can widen". An audience combines users, groups, roles, companies, units (± subtree), locations (± subtree), requester groups, employee type and conditions. Bases with no audience follow an explicit tenant default (internal-only). Drafts, review comments and retired versions are visible only to contributors and approvers.
- Build: `audience`, `audience_binding`; compiled into `acl_keys` on article, version, chunk and snippet; evaluated in lists, search, chat, API and MCP.

**KB-031 · Public and anonymous knowledge** — دانش عمومی و دسترسی ناشناس
- P1 · AI: no · Sources: JSM (public, search-engine indexable help centre), Freshservice ("All users"), KCS (Public audience, SEO), BMC (Guest Portal Navigator).
- What/how: Public bases or articles are readable without sign-in, with SEO-friendly URLs, sitemap, Open Graph tags and robots controls. The guest assistant answers only from public content.
- Build: `t:public` key; public route with CDN caching; separate public index.

**KB-032 · Confidential knowledge partitions** — بخش‌بندی دانش محرمانه
- P0 · AI: yes (index isolation) · Sources: Freshservice (restricted workspaces), ServiceNow (HR criteria, scoped apps), BMC Helix (company-scoped known errors via field 112; agentic AI pinned to the ticket's company), access.md (secure workspaces, classification, MSP domains).
- What/how: HR, legal, security and executive knowledge lives in secure workspaces or classified bases that only explicit members can read; tenant admins get no implicit access. In MSP mode each customer domain or company gets its own scope. Chunks go to separate index partitions so no other assistant can retrieve them.
- Build: `workspace_id`, `classification`, `domain_id`, `company_id` on base and article; restriction keys; partitioned chunks.

**KB-033 · Access diagnostics for knowledge** — عیب‌یابی دسترسی به دانش
- P1 · AI: yes (narration via AI-146) · Sources: ServiceNow (User Criteria Diagnostics), Moveworks (Permissions Checker, Data Ingestion View), access.md (explain, view-as, who-can-see).
- What/how: For any user and article or document: can read? can contribute? why (which binding or restriction)? Plus "view the portal as user X", "who can see this article" (counts and samples) and "may the AI use it in this channel".
- Build: deterministic explain trace from the policy compiler; the AI only narrates the trace.

**KB-034 · AI-use policy for content** — سیاست استفاده هوش مصنوعی از محتوا
- P0 · AI: yes · Sources: BMC HelixGPT (admin decides whether internal articles may be used as context; unpublished articles removed from the vector DB), Microsoft 365 Copilot (EXTRACT usage right; Restricted Content Discovery), Atlassian (MCP control in data security policies), Freshservice (knowledge sources filtered per AI agent).
- What/how: Per base, category, article and document: AI may read (yes/no); may extract text into answers or only link; allowed personas (agent-facing only or also requester-facing); allowed channels (portal, messengers, MCP, offline). Defaults: drafts, retired and outdated versions never; internal sections only for agent-facing assistants; secret and sensitive classes never.
- Build: `ai_policy` columns with inheritance; chunk flags (`ai_extract_allowed`, `persona_mask`); enforced in the retrieval WHERE clause; platform policy AI-156.

#### E. Search and findability

**KB-035 · Persian-aware full-text search** — جست‌وجوی متنی سازگار با فارسی
- P0 · AI: no · Sources: ServiceNow AI Search (synonyms, result-improvement rules), Ivanti (partial-word matching), KCS T6.3, ITIL KM pitfalls (difficult interfaces, poor search), analytics_ux (Persian normalisation).
- What/how: Normalisation of Arabic/Persian letters (ي→ی, ك→ک), half-space/ZWNJ, diacritics, tatweel and Persian/Arabic/Latin digits; Persian and English stemming and stop words; typo tolerance; partial-word and phrase matching; synonyms; facets (base, category, type, language, updated, owner); highlighted snippets; sort by relevance, recency or popularity; saved filters; search inside attachments and documents.
- Build: Postgres FTS with a custom Persian configuration (or OpenSearch analyzer); `acl_keys` pre-filter; one query normaliser shared with RAG.

**KB-036 · Semantic and hybrid search** — جست‌وجوی معنایی و ترکیبی
- P0 · AI: yes · Sources: ServiceNow AI Search (semantic plus keyword; AI Search RAG 6.1.0 hybrid default), Ivanti 2026.1 (related terms: "PC" finds computer, laptop, desktop; semantic preview), Atlassian Rovo Search, Moveworks, OpenText SMAX Smart Search (IDOL).
- What/how: Embedding search finds meaning (a Persian query finds an English article; "کندی شبکه" finds "slow VPN"); results merge with keyword search by reciprocal rank fusion and are optionally re-ranked; every article shows semantically related articles; queries are rewritten with the glossary and acronyms.
- Build: shared retrieval pipeline AI-009–AI-011 with knowledge as a source; multilingual embeddings.

**KB-037 · Federated enterprise search** — جست‌وجوی یکپارچه سازمانی
- P1 · AI: yes · Sources: ServiceNow (AI Search external content connectors; Moveworks enterprise search), Atlassian Rovo (Teamwork Graph connectors), Freshservice (SharePoint, Google Drive, Confluence, URLs with up to 3,000 child links), Zendesk (Unleash), Glean (pattern); KCS T6.3 (federated search over KB, known errors, catalogue and community).
- What/how: One search box over articles, known errors, snippets, catalog items, documents, community answers, announcements and connected external sources (SharePoint, Confluence, Google Drive, OneDrive, file shares, intranet sites). Each result shows its source icon and an Internal/External tag and honours source permissions (mirrored ACLs, managed rules or live per-user search).
- Build: connector framework AI-015; `kb_external_item(acl_principals, acl_keys)`; freshness window; result-type adapters.

**KB-038 · Relevance tuning and search administration** — تنظیم ربط و مدیریت جست‌وجو
- P1 · AI: no · Sources: ServiceNow (search profiles, synonyms, result-improvement rules), Freshservice (keywords for boosting), KCS T6.3 (relevance feedback from link events).
- What/how: Synonym sets (Persian/English, colloquial/technical), promoted or pinned results per query, boosts by type/recency/popularity, demote or hide rules, search profiles per portal or persona, ranking that learns from link events (articles linked after a query rank higher), and a test console showing why a result ranked where it did.
- Build: `search_rule`, `synonym_set`; ranking features logged per query.

**KB-039 · Glossary and definitions** — واژه‌نامه و تعاریف سازمانی
- P1 · AI: yes · Sources: Atlassian Rovo (Definitions: company jargon cards), BMC HelixGPT (prompt extensions for organisation-specific terms), ai.md (acronym expansion from a tenant glossary).
- What/how: A tenant glossary of terms, acronyms and Persian equivalents (including officially approved Persian equivalents) shown as hover cards in articles and tickets, used to expand search queries, and injected into AI prompts so models understand local jargon.
- Build: `kb_glossary_term(term, synonyms[], definition, language, audience)`; query rewriter; context builder.

**KB-040 · Search analytics** — تحلیل جست‌وجو
- P0 · AI: no · Sources: ServiceNow (zero-result searches, AI Search analytics), JSM, ITIL (top, zero-result and click-through queries), KCS T6.3.
- What/how: Top queries, zero-result queries, low click-through queries, abandoned searches, searches followed by a ticket within N hours and top clicked results, per portal, persona and language, with export. Feeds gap detection (KB-072).
- Build: knowledge event stream (KB-064); aggregations; pseudonymised user ids.

#### F. Knowledge in the flow of work

**KB-041 · Contextual article suggestions on records** — پیشنهاد مقاله در کنار رکورد
- P0 · AI: yes · Sources: ServiceNow (contextual search on forms and record producers; Agent Assist recommended actions), JSM (KB panel "KB Glance": ≤10 results with source icon and Internal/External tag), Freshservice (Knowledge Content Recommendations), ManageEngine SDP (suggested solutions), BMC Helix (Smart Recorder).
- What/how: A panel on incident, request, problem, change and case forms suggests articles, snippets, known errors and documents from title, description, CI, service and category, refreshing as fields change. Each suggestion shows confidence, Internal/External tag and last review date, with one-click Attach, Insert into reply and Apply workaround.
- Build: retrieval skill with record context under the caller's permissions; event logging (`suggest`, `click`, `link`).

**KB-042 · Link article to record and reuse counting** — پیوند مقاله به رکورد و شمارش استفاده مجدد
- P0 · AI: no · Sources: KCS v6 T3.3 (linking; reuse is review), ServiceNow (use count = times attached to tasks), ManageEngine SDP ("Referred Solutions" with associated-request tracking), BMC Helix.
- What/how: Link types: solved by, related, workaround applied, created from, cited by AI. Reuse = number of distinct records linked, not views. Links can be made from forms, lists, chat and the agent panel; unlinking needs a reason; link accuracy is sampled for coaching (KB-056).
- Build: `kb_link(article_id, version_id, record_type, record_id, link_type, linked_by, linked_at)` unique per (record, article, type); counters via the event stream.

**KB-043 · Respond with an article (safe sharing)** — پاسخ با مقاله (اشتراک‌گذاری امن)
- P0 · AI: no · Sources: JSM (internal articles insert into internal notes, external into customer replies; "Respond with article"; automation to auto-comment articles on new requests), Freshservice (insert article into reply), ServiceNow.
- What/how: Insert an article link, excerpt or full content into a reply. The composer refuses to put internal articles or internal sections into a public reply. Automation can reply to new requests with the top permitted articles.
- Build: composer action checks field class and audience against every recipient; automation action `kb.suggest_reply`.

**KB-044 · Flag an article or report a knowledge gap** — گزارش ایراد مقاله یا کمبود دانش
- P0 · AI: no · Sources: ServiceNow (flag article; "Report a knowledge gap" from an incident, Xanadu), KCS v6 T4.2 ("flag it or fix it"), ITIL, Freshservice.
- What/how: Readers and agents flag an article with a reason (incorrect, outdated, unclear, duplicate, missing step, broken link, other) and a comment, or report from a record that no article exists for its issue. Both create a knowledge task for the owner group. Licensed agents can fix the article immediately instead.
- Build: `kb_feedback(kind=flag)` → `kb_task`; routing rules.

**KB-045 · Knowledge task queue with SLA** — صف کارهای دانش با SLA
- P0 · AI: yes (feedback de-duplication) · Sources: ServiceNow (`kb_feedback_task`; Knowledge Fulfillment Tasks on by default July 2026; AI de-duplication of feedback tasks June 2026), KCS v6 T6.4 (closed-loop feedback), ITIL.
- What/how: One queue numbered `KBT-nnnnnn` for flags, gaps, reviews, translations, merges, quality reviews and retirement proposals, assigned to owner groups with a flag-age SLA, bulk actions and dashboards. AI groups duplicate feedback on the same article and proposes the fix.
- Build: `kb_task` on the SLA engine, assignment rules and notifications; skill `kb.feedback_cluster`.

**KB-046 · Known-error articles** — مقاله‌های خطای شناخته‌شده
- P0 · AI: yes (draft from the problem) · Sources: ServiceNow (KE article drafted from problem statement, description, workaround and cause), Freshservice (problem → known-error articles), JSM (restricted KE articles), BMC Helix (Known Error template), ITIL (KEDB), ISO/IEC 20000-1 §8.6.3 (known errors available to incident handlers).
- What/how: From a problem or known error, publish an article with symptom, cause, workaround and fix status, internal by default and external after approval. Synced fields update the article when the problem changes. KE articles are suggested at incident creation; "Apply workaround" links the incident. When the problem closes with a permanent fix, the article is updated or retired automatically.
- Build: `problem.known_error_article_id`; sync flow; Known error template.

**KB-047 · Agent-executable procedures** — رویه‌های قابل‌اجرا برای عامل هوشمند
- P1 · AI: yes · Sources: Atlassian Request Resolver ("write knowledge Request Resolver can follow"; internal runbooks and an "Admin guidance" page), Zendesk (procedures written in natural language), HaloITSM (runbooks), ServiceNow (AIOps LEAP playbooks).
- What/how: Internal runbooks in a prescribed structure (when to use, preconditions, numbered steps with explicit conditions, exact field and status changes, canned replies, tools to call) that AI agents execute. They are never quoted to requesters, are validated by a dry run in the agent playground, and are versioned and approved like code.
- Build: article type `procedure` whose steps reference tool ids; agent retrieval scope "procedures"; approval required to publish.

**KB-048 · Subscriptions and change notifications** — اشتراک و اعلان تغییرات
- P1 · AI: no · Sources: ServiceNow (knowledge subscriptions; notifications on article updates).
- What/how: Follow an article, category or base and get notified on publish, major update or retirement. Owners of open records linked to an article are told when it changes (for example, a workaround was updated).
- Build: `kb_subscription(user_id, object_type, object_id, channel)`; notification rules, including messenger channels.

#### G. Self-service and deflection

**KB-049 · Portal knowledge experience** — تجربه دانش در پرتال
- P0 · AI: no · Sources: all tools (ServiceNow Employee Center and `/kb`, JSM help centre, Freshservice portal, ManageEngine SDP, BMC Digital Workplace).
- What/how: Knowledge home with search, categories, featured, popular, new and recently viewed articles. The article page has breadcrumbs, last-reviewed date (Jalali), related articles, attachments, feedback at the bottom (as in ServiceNow Zurich), print/PDF, share link and copy-code buttons. Same views in the mobile web and the Windows app; full RTL layout; WCAG 2.2 AA.
- Build: portal pages; responses cached per audience fingerprint; PDF renderer.

**KB-050 · Type-ahead deflection while raising a request** — پیشنهاد مقاله هنگام ثبت درخواست
- P0 · AI: yes · Sources: JSM (suggestions while typing the Summary, optionally limited by labels), Freshservice (suggested articles while typing the subject), ServiceNow (in-form deflection, July 2026; AI ticket suggestions in Service Portal), ManageEngine SDP (RAG solution suggestions while filling the form).
- What/how: As the requester types subject and description, matching articles, snippets and known outages appear. "This solved my problem" ends the form and records a deflection; otherwise the viewed articles are attached to the new ticket so the agent knows what was tried.
- Build: debounced retrieval as the requester persona; `deflect` event; viewed articles stored on submit.

**KB-051 · Suggested solutions in acknowledgements** — ارسال راه‌حل پیشنهادی در پاسخ خودکار
- P1 · AI: yes · Sources: ManageEngine SDP (Auto Reply Solution, `$ZiaSolutionSuggest`), BMC Helix (automatic email responses with KB summary and a resolve option, 26.1.01), SysAid (AI Emailbot).
- What/how: The acknowledgement e-mail, SMS or messenger message for a new ticket includes the top one to three permitted articles or a short grounded answer, with a signed "this solved it, close my ticket" link.
- Build: notification template variable that calls a retrieval skill as the requester; signed one-click close link.

**KB-052 · Deflection measurement** — سنجش حل‌شدن بدون ثبت درخواست
- P0 · AI: yes (topic matching) · Sources: JSM (Requests deflected; Requests resolved with vs without articles), ServiceNow (KB and catalog items behind Virtual Agent deflections, May 2026), KCS v6 T5.11–5.12, ITIL (shift-left).
- What/how: Sessions are tracked (search → view → helpful vote → no ticket). A session counts as deflected when the same user opens no ticket on the same topic within 24–72 hours (embedding match) or explicitly marks "solved my problem". Reports by article, category, channel and persona.
- Build: sessionised event stream; nightly job with topic similarity.

**KB-053 · Personalised and proactive knowledge** — دانش شخصی‌سازی‌شده و پیش‌دستانه
- P2 · AI: yes · Sources: Moveworks (Content Activities), InvGate (most-used categories first), Ivanti ("new since your last visit"), standards (proactive suggestions).
- What/how: Recommendations by role, department, location, device and language; banner articles for active outages on the user's services; onboarding knowledge packs for new hires.
- Build: recommendation job over profile and usage features; audience still enforced.

#### H. Feedback and quality

**KB-054 · Ratings, helpfulness and comments** — امتیاز، مفید بودن و نظرات
- P0 · AI: no · Sources: all tools (helpful yes/no, 5-star rating, comments; Freshservice "not helpful" can open a ticket; ServiceNow per-base switches).
- What/how: "Was this helpful?" with reason and comment, optional star rating, and internal comment threads for agents. "Not helpful" can open a ticket pre-filled with the article. One vote per user or session. A rule opens an owner task when the negative ratio passes a threshold.
- Build: `kb_feedback`; counters; threshold rule.

**KB-055 · Content Standard Checklist (AQI) reviews** — ارزیابی کیفیت محتوا با چک‌لیست استاندارد (AQI)
- P1 · AI: yes (AI pre-scoring) · Sources: KCS v6 T5.3 (Content Standard Checklist, formerly AQI), ServiceNow (Article Quality Index with weighted checklists and trends), BMC Helix, analytics_ux (AQI formula).
- What/how: Each month N articles per author are sampled into coach review tasks with a weighted yes/no checklist: unique, complete, clear, title reflects the issue, environment and cause present, correct metadata and audience, links work, readable. AQI = 100 − Σ(weighted defects) ÷ articles sampled, trended per author and team. AI pre-scores every item with quoted evidence for the coach.
- Build: `kb_quality_review`, checklist definitions; sampling job; skill `kb.aqi_prescore`.

**KB-056 · Process Adherence Review (PAR)** — بازبینی پایبندی به فرایند KCS
- P2 · AI: no · Sources: KCS v6 T6.5 and T7.3 (link rate, link accuracy, modify rate, create rate, Contribution Index; PAR 2.0, July 2025).
- What/how: A sampled coaching instrument per contributor. Goals are set only on outcome measures, never on activity measures. Results are visible only to the person and their coach (purpose limitation).
- Build: sampling over closed records; per-criterion results; restricted visibility.

**KB-057 · Knowledge health score** — امتیاز سلامت دانش
- P1 · AI: yes · Sources: ServiceNow Knowledge Center (knowledge health score, optimisation opportunities, next-best actions), TOPdesk (AI Readiness Dashboard), ai.md (quality and freshness signals).
- What/how: A per-article score from freshness (days to valid-to or since last review), feedback ratio, use and view trend, duplicate status, readability and length, AQI, broken links, and reopen spikes of linked records; aggregated per base and owner, with a next-best action per article (update, merge, retire, translate).
- Build: nightly `kb_health_score` job with configurable weights; dashboard cards.

**KB-058 · Content integrity checks** — بررسی یکپارچگی محتوا
- P1 · AI: no · Sources: ai.md (freshness signals: retired CIs, services and product versions; broken links), ServiceNow (article optimisation scans: accessibility, length).
- What/how: Scheduled checks for broken links, missing images, references to retired CIs, services, catalog items or product versions (checked against the CMDB and software catalogue), missing alt text and very long articles. Findings create knowledge tasks.
- Build: link extractor; CMDB and catalogue lookups; task creation.

#### I. Multilingual knowledge

**KB-059 · Translations linked to the master** — ترجمه‌های پیوسته به نسخه اصلی
- P0 · AI: no · Sources: ServiceNow (translated versions linked to the original, Localization Framework, language-aware search with fallback), Freshservice (portal languages and article translations), BMC Helix (ComAround and IS KM translation), KCS v6 T5.8.
- What/how: Each translation is bound to a master version and has its own state. A new major master version marks translations stale. Translation tasks, a language switcher, and search fallback to the master language when no translation exists. Persian and English are first-class; Arabic, Kurdish, Azerbaijani Turkish and others can be added.
- Build: `translation_of_article_id`, `master_version_id`; stale flag; `kb_task kind=translation`.

**KB-060 · Machine translation with human validation** — ترجمه ماشینی با تأیید انسانی
- P1 · AI: yes · Sources: ServiceNow (Localization Framework machine + human translation), TOPdesk (AI Translation), Freshservice (Freddy translation), ManageEngine SDP (translate AI-generated solutions), BMC (ComAround real-time translation), Ivanti (swappable translation engines).
- What/how: One-click draft translation that uses the glossary, labelled "machine translated" until a human validates it. Optional on-the-fly translation for readers whose language has no validated version.
- Build: translation skill AI-028 (LLM or MT engine) with glossary injection; provenance flags.

#### J. Tacit knowledge

**KB-061 · Q&A community** — انجمن پرسش‌وپاسخ
- P2 · AI: yes (suggests existing answers) · Sources: ITIL 4 (SECI socialisation and externalisation), ServiceNow (communities), KCS.
- What/how: Employees and agents ask questions and others answer. Accepted answers can be converted into articles. Experts are notified by topic, and similar existing questions are suggested before posting.
- Build: `kb_question`, `kb_answer` with audiences; convert-to-article action.

**KB-062 · Expert directory** — فهرست خبرگان
- P2 · AI: yes · Sources: ITIL (expert directory), InvGate (Expert Collaboration), ManageEngine SDP (Collaborator Suggestion).
- What/how: "Who knows about X", with experts inferred from resolved records, authored and validated articles and accepted answers. People confirm their own skills; the directory is never used to evaluate individuals.
- Build: skills inference job; opt-in profile; EU AI Act-safe design (AI-180).

#### K. Knowledge analytics

**KB-063 · Knowledge dashboards** — داشبوردهای دانش
- P0 · AI: no · Sources: ServiceNow (articles by state and age, views, use count, ratings, feedback backlog, zero-result searches), Freshservice (views, votes, AI-agent usage of articles, Copilot article-generation reports), JSM (requests deflected, article performance), BMC Helix (knowledge value dashboards, ISKM translated-article adoption).
- What/how: Dashboards for knowledge managers, owners and authors: inventory by state, age, base and owner; expiring and flagged articles; feedback backlog; reuse; top and bottom articles; search gaps; deflection; translation coverage; AI citations; acceptance of AI drafts.
- Build: report engine over the event stream, scoped by the viewer's access.

**KB-064 · Knowledge event stream** — جریان رویدادهای دانش
- P0 · AI: no · Sources: analytics_ux (view, search, link, feedback and vote events as a stream), JSM (deflection needs event tracking).
- What/how: Append-only events: `search(query, results_count)`, `view`, `click(position)`, `vote`, `rating`, `flag`, `link(reuse|create)`, `deflect`, `ai_answer`, `ai_citation`, `ai_abstain`, `attest`. Every knowledge KPI is a query over this stream.
- Build: `kb_event`, partitioned monthly, with retention and optional pseudonymisation.

**KB-065 · Knowledge manager workspace** — میز کار مدیر دانش
- P1 · AI: yes · Sources: ServiceNow Knowledge Center (insights dashboard, gap analysis, duplicates, optimisation scans, KM tools), TOPdesk (AI Readiness Dashboard).
- What/how: One workspace with insight cards (top actions, duplicates, health, gaps, expiring, flags), work queues, bulk actions (re-own, re-categorise, retire) and AI suggestions to create, update, merge or retire, each with accept or dismiss.
- Build: workspace page composed from knowledge features; suggestion cards produced by the knowledge AI jobs.

#### L. AI for knowledge

**KB-066 · AI article drafting from a resolved record** — نگارش خودکار مقاله از رکورد حل‌شده
- P0 · AI: yes · Sources: ServiceNow (KB generation from incidents, cases, HR cases and work orders; KCS template; several languages), BMC HelixGPT (Knowledge Curator), Atlassian Rovo ("create KB article from issue"), Freshservice (Help Article Generator), ManageEngine SDP (Solution Generator; KB Article Generator agent), TOPdesk (Knowledge Item Creation; Robin turns fixes into knowledge), Ivanti, InvGate, Xurrent (Sera), SolarWinds (AI KB generation); ITIL v5 (Creation capability); KCS.
- What/how: Drafts an article in the chosen template (KCS issue, environment, resolution and cause, plus title and keywords) from a resolved incident, request, problem, case or work order, or from a chat or call transcript, in the user's language. Names, contact data, IPs and hostnames (per policy) and secrets are removed; source record numbers are kept as hidden citations. The draft is saved as Draft or WIP with an "AI-drafted" label and goes through normal review. Eligibility: resolved or closed, no linked article, resolution code not duplicate/user error/cancelled, and novelty (maximum similarity to the existing KB below 0.80). External content is never auto-published.
- Build: skill `kb.draft_from_record` (large tier); PII scrubber; validation agent KB-071; `ai_provenance` on the version; optional trigger on close in the llm job lane.

**KB-067 · AI article from a cluster of similar records** — مقاله از خوشه رکوردهای مشابه
- P1 · AI: yes · Sources: ServiceNow (article from a group of similar incidents, Aug 2024), JSM (pre-generated drafts for request clusters with ≥5 related requests in the last 30 days; excludes work items with a security level), Atlassian guidance (generate from about ten resolved items, then merge).
- What/how: Groups 3–10 similar resolved records and drafts one consolidated article whose environment section lists the variants. Records with security levels or restricted classifications are excluded from the inputs.
- Build: clustering job plus drafting skill; citations to every source record.

**KB-068 · AI articles from a topic or uploaded material** — تولید مقاله از موضوع یا مستندات بارگذاری‌شده
- P1 · AI: yes · Sources: JSM (Create with Rovo: interviews the admin, accepts PDFs, links and notes, drafts a full KB set on a canvas, saves as drafts or publishes all), Freshservice (Help Article Generator from a topic and public sources), ServiceNow (AIOps LEAP: articles with command snippets and playbooks; resolution steps from web sources), Rovo `/manage-knowledge-base`.
- What/how: The author gives a topic or outline, or uploads documents and links. AI asks clarifying questions, proposes a set of articles (titles and outlines) on a canvas, then drafts them. Web and public sources are used only when the tenant enables them (always off in sovereign mode).
- Build: multi-step skill with a canvas UI; documents through the KB-012 pipeline; web tool behind policy.

**KB-069 · Writing assistant in the article editor** — دستیار نگارش در ویرایشگر مقاله
- P0 · AI: yes · Sources: ServiceNow (expand, shorten, rewrite in the context menu; Knowledge Center editor with custom instructions), Atlassian (Rovo editor actions), Zendesk (help-centre rewrite and tone tools), TOPdesk (Writing Assistant), InvGate (Improve Content with apply, discard, undo), Zammad, ManageEngine SDP (Writing Assistant).
- What/how: Improve, expand, shorten, summarise, simplify, fix grammar and spelling, change tone (formal, neutral, friendly; Persian formal register), turn prose into numbered steps, replace agent jargon with portal language, and generate title and summary. Every action can be applied, discarded or undone; bases can add custom instructions.
- Build: writing skills of AI-027 bound to the editor.

**KB-070 · AI metadata suggestions** — پیشنهاد فراداده با هوش مصنوعی
- P1 · AI: yes · Sources: ManageEngine SDP (Solution Generator: title, description, keywords), ITIL v5 (auto-tagging), Freshservice.
- What/how: Suggests title, summary, keywords, tags, category, linked services, CIs and catalog items, audience and related articles, each with a confidence; the author accepts each suggestion.
- Build: small-tier classification and extraction skill.

**KB-071 · Validation agent for AI drafts** — عامل اعتبارسنجی پیش‌نویس‌های هوش مصنوعی
- P1 · AI: yes · Sources: BMC HelixGPT ("BWF - Generate IS Validate" second agent), ai.md (validation pattern).
- What/how: A second model checks a draft against its sources for unsupported claims, missing prerequisites, unsafe commands (destructive shell or registry commands), personal data and internal content in external sections. It returns issues and a score; submission for review is blocked below a threshold.
- Build: skill `kb.validate` → `{issues[], score}`; guard on the transition to review.

**KB-072 · Knowledge gap detection** — کشف شکاف دانش
- P1 · AI: yes · Sources: ServiceNow (Knowledge Gaps skill; Knowledge Center gap analysis), JSM (Suggested topics, refreshed weekly; a topic appears when more than 5 related requests have no matching article), Zendesk (Knowledge Base Gaps Discovery over bot conversations; replaced Content Cues), InvGate (Knowledge Discovery), Serviceaide (Luma Knowledge), ITIL (content-gap clusters), KCS.
- What/how: Weekly clustering of demand signals: zero-result searches, records without a linked article, AI abstentions ("I don't know") and unanswered virtual-agent intents. Coverage = maximum similarity of the cluster centroid to any published article readable by the affected audience; gap score = demand × (1 − coverage). The list shows volume, trend, sample records, an LLM-named topic and a proposed outline, with "Create article" (AI draft) or "Dismiss".
- Build: `kb_gap`; clustering job (HDBSCAN or agglomerative); naming skill; knowledge tasks.

**KB-073 · Duplicate and conflicting article detection** — کشف مقاله‌های تکراری و متناقض
- P1 · AI: yes · Sources: ServiceNow ("identify duplicate articles" skill; Knowledge Center duplicate detection and merge; auto-merge Aug 2026), Zendesk (Content Cues, retired 2025), KCS ("unique" checklist item).
- What/how: Candidate pairs come from MinHash/LSH (near-identical text) and embedding cosine ≥ 0.90 (paraphrases). An LLM judge labels each pair duplicate, overlapping, distinct or contradicting and proposes a merged article with redirects. Source visibility is preserved and redundant articles are retired after approval. The same check runs when a new draft is saved.
- Build: `kb_duplicate_candidate`; merge workflow; redirects.

**KB-074 · Article quality and optimisation scans** — پویش کیفیت و بهینه‌سازی مقاله
- P1 · AI: yes · Sources: ServiceNow (Article Optimization: accessibility, searchability, quality and length scans; default skill and custom prompts), BMC HelixGPT (knowledge-article improvement agent), KCS (AQI as an automated rubric).
- What/how: An LLM rubric (title states the symptom, environment given, numbered verifiable steps, one issue per article, no internal data in external sections, links resolve) plus readability and length scores, shown as inline suggestions the author can accept.
- Build: skill `kb.optimize`; results stored per version.

**KB-075 · Stale and obsolete content detection** — کشف محتوای کهنه و منسوخ
- P1 · AI: yes · Sources: ServiceNow Knowledge Center (suggestions to update, merge or retire stale content), ITIL v5 (flagging obsolete articles), Serviceaide Luma (retirement of unused articles), ai.md.
- What/how: Flags articles that mention retired product versions or CIs, whose linked records are being reopened, whose helpfulness drops, or that a newer circular or policy supersedes, and proposes an update or retirement to the owner.
- Build: nightly job combining KB-058 signals with an LLM check of version and policy references.

**KB-076 · Knowledge Curator agent** — عامل متولی دانش
- P1 · AI: yes · Sources: BMC HelixGPT (Knowledge Curator: creates articles from incidents and improves existing ones from incident data), ServiceNow (KM tools and next-best actions), Serviceaide (Luma improvement loop), Atlassian (AtlasCamp 2026 agent that scans resolved tickets and drafts articles where it finds gaps).
- What/how: A scheduled agent scans recently resolved records, checks coverage, drafts new articles, proposes improvements to existing articles from new resolutions, merges duplicate feedback and prepares each owner's review queue. Supervised by default; it never publishes external content.
- Build: `ai_agent` (AI-074) with knowledge tools (search, draft, propose edit, create task), running as an AI user whose contribute rights are limited to drafts.

**KB-077 · AI readiness of the knowledge base** — آمادگی پایگاه دانش برای هوش مصنوعی
- P1 · AI: yes · Sources: TOPdesk (AI Readiness Dashboard: volume, freshness, usage; Oct 2026), others.md (readiness formula).
- What/how: A score per category from coverage (articles ÷ tickets), freshness (median days since review), usage (views and helpful ratio) and grounding rate (share of AI answers that cite an article), with the gaps of each category and a "create article" call to action.
- Build: KPI job; dashboard.

**KB-078 · Generative answers grounded in knowledge** — پاسخ مولد مستند به دانش
- P0 · AI: yes · Sources: ServiceNow (Now Assist in AI Search / Genius Results, shown only when a relevant article the user can access exists), JSM (AI answers), Zendesk (generative search), Freshservice (AI Agent answers with citations), TOPdesk (Answer Assistant, AI Search), ManageEngine SDP (Solution Assist: multi-article summaries with citations, including attachments), Ivanti (Knowledge Search & Incident Deflection).
- What/how: Above search results in the portal, agent search, chat and messengers, an answer is composed only from permitted articles, snippets and documents, with numbered citations and a "was this helpful" control. It abstains when retrieval confidence is low. The agent-facing variant may use internal sections; the answer follows the user's language.
- Build: retrieval and generation pipeline AI-009–AI-013 with knowledge and documents as sources; abstention threshold per surface.

**KB-079 · Personal-data and secret scan before publishing** — پویش داده شخصی و اطلاعات محرمانه پیش از انتشار
- P0 · AI: yes · Sources: KCS v6 T5.1 (no requester-specific data in articles), GDPR Art. 5(1)(c), standards (PII detection and redaction), access.md (sensitive-data classifier).
- What/how: Before an article moves beyond Internal, and on every AI draft, the system detects personal data (names, national ID, mobile number, e-mail, address, card number, IBAN/Sheba), credentials and internal hostnames or IPs, and blocks or requires redaction with highlighted spans.
- Build: regex plus NER classifier (AI-149); transition guard.

**KB-080 · AI provenance labels on content** — برچسب منشأ هوش مصنوعی روی محتوا
- P0 · AI: yes · Sources: standards (AI-drafted or AI-translated articles carry model, prompt source and reviewer, labelled until a licensed human validates; EU AI Act Art. 50(2); ISO/IEC 42001 A.8), HaloITSM (AI provenance flags on KB articles), TOPdesk (AI output labelled).
- What/how: Every AI-generated or AI-translated version stores model, prompt version, source records and reviewer. Readers see "drafted with AI, reviewed by …" or "machine translated"; the label clears only when a licensed human validates the version.
- Build: `ai_provenance` JSON on the version; label component (AI-164).

**KB-081 · Reuse-pattern analysis to problem candidates** — تحلیل الگوی استفاده مجدد برای کشف مسئله
- P2 · AI: yes · Sources: KCS v6 T5.9 (Knowledge Domain Analysis of reuse and link patterns), ITIL (problem candidates).
- What/how: Articles with rising reuse signal recurring issues. The system proposes problem candidates with the linked records to problem management, and evolve-loop articles to the knowledge domain expert.
- Build: trend job over `kb_link`; proposal into the problem module.

**KB-082 · Offline knowledge in the Windows app** — دانش آفلاین در نرم‌افزار ویندوز
- P1 · AI: yes (local search; optional local model) · Sources: no vendor offers it; access.md (permission-exact offline replica).
- What/how: The Windows app syncs the articles, snippets and documents the user may read for offline search and reading. An optional local small model answers only over the device replica. Feedback, flags and drafts queue until the next sync.
- Build: sync buckets keyed by access keys; local full-text index; offline AI limited to the replica.

### Data model

**Record tables** (all secured tables carry `tenant_id, domain_id, workspace_id, classification, acl_keys text[] (GIN), acl_version, external_visible`, as in the access model):

| Table | Prefix | Key fields | States (→ category) | Relationships |
|---|---|---|---|---|
| `kb_base` | — | name_fa, name_en, kind {internal, external}, owner_id, manager_group_id, publish_flow_id, retire_flow_id, default_valid_days, versioning, kcs_enabled, languages[], toggles{comments, ratings, suggestions}, default_audience_policy {internal_only, everyone, closed}, ai_policy | active, archived (closed) | has many categories, articles; audience bindings |
| `kb_category` | — | base_id, parent_id, path, sort, icon, featured_article_ids[], managed_by_group_ids[] | active, archived | tree via closure table |
| `kb_article` | `KB-` | number, base_id, category_id, type, template_id, published_version_id, draft_version_id, lifecycle_state, kcs_confidence {wip, not_validated, validated, archived}, kcs_audience {internal, domain, partners, customers, public}, governance {experience, compliance}, owner_id, owner_group_id, author_id, valid_from, valid_to, review_at, language, translation_of_article_id, replaced_by_article_id, ai_policy {read, extract, personas, channels}, counters (views, reuse_count, helpful_yes, helpful_no, rating_avg, open_flags, ai_citations), source_record_ref (WIP) | wip → **new**; draft → **new**; in_review, approved/scheduled → **waiting**; published → **active**; pending_retirement → **waiting**; retired, archived → **closed**; rejected, cancelled → **canceled** | versions, links, feedback, tasks, translations, `kb_article_ref` (CI, service, offering, catalog item, product+version), problem (known error) |
| `kb_article_version` | — | article_id, major, minor, title, summary, body_json, sections_json (issue, environment, resolution, cause, cause_test, internal_resolution…), keywords[], tags[], language, master_version_id, created_by, change_note, approval_snapshot, ai_provenance {model, prompt_version, source_refs[], validated_by, validated_at}, content_hash, word_count, readability | draft → new; review → waiting; published → active; outdated → closed; rejected → canceled | belongs to article; blocks used |
| `kb_template` | — | name, type, sections schema (key, label, guidance, required, field_class), allowed_base_ids[], ai_skill_id | active, retired | used by articles |
| `kb_block` / `kb_block_usage` | — | title, body, version, audience; usage(article_version_id, block_id) | draft, published, retired | embedded in many articles |
| `kb_snippet` | `KBS-` | question, answer, source_ref, language, audience, valid_to, ai_generated | draft → new; published → active; retired → closed | source article/record |
| `kb_link` | — | article_id, version_id, record_type, record_id, link_type {solved_by, related, workaround, created_from, cited_by_ai}, linked_by, linked_at, accuracy_sample | — (event-like) | article ↔ incident/request/problem/change/case/work order |
| `kb_feedback` | — | article_id, version_id, user_id, kind {helpful, not_helpful, rating, comment, flag}, reason {incorrect, outdated, unclear, duplicate, missing_step, broken_link, other}, comment, channel, session_id | open → new; linked to task → active; addressed → closed | creates `kb_task` |
| `kb_task` | `KBT-` | kind {flag, gap, review, translation, merge, retire, aqi_review, attestation, re_own}, article_id, gap_id, feedback_ids[], assignee_id, group_id, due_at, sla_state, resolution | new → **new**; assigned, in_progress → **active**; waiting_author, waiting_sme → **waiting**; done → **resolved**; verified → **closed**; dismissed → **canceled** | article, gap, feedback |
| `kb_gap` | `KGP-` | label, centroid (vector), demand {incidents, requests, searches, ai_abstentions, va_unanswered}, coverage, score, trend, sample_refs[], outline, audience_ids[] | open → new; in_progress → active; covered → resolved; dismissed → canceled | task, resulting article |
| `kb_duplicate_candidate` | — | article_a, article_b, method {minhash, embedding}, similarity, verdict {duplicate, overlapping, distinct, contradicting}, merged_into | proposed → new; in_review → waiting; merged → resolved; rejected → canceled | merge task |
| `kb_quality_review` | — | version_id, reviewer_id, checklist_id, results_json, score, ai_prescore_json | via `kb_task` | author, coach |
| `kb_health_score` | — | article_id, computed_at, freshness, feedback_ratio, usage_trend, duplicate_flag, readability, aqi, broken_links, overall, next_action | snapshot | article |
| `kb_event` | — | at, session_id, user_ref, persona, channel, event, query_norm, results_count, article_id, record_ref, position | append-only | analytics |
| `kb_subscription` | — | user_id, object_type, object_id, channel | — | — |
| `kb_attestation` / `kb_attestation_ack` | `ATT-` | version_id, audience_id, due_at, reminder_plan; ack(user_id, at) | open → active; overdue → waiting; complete → closed | compliance article |
| `kcs_licence` | — | user_id, level {candidate, contributor, publisher, coach}, domain_id, granted_at, expires_at, revoked_at, evidence | active, expired, revoked | knowledge domain |
| `kb_domain` / `kb_routine` | — | domain(name, kde_user_id, scope); routine(condition AST, schedule, target_days, compliance) | active, retired | categories, services |
| `kb_glossary_term` | — | term, synonyms[], definition, language, audience | active, retired | — |
| `kb_decision_tree` | — | nodes_json, start_node, version | draft, published, retired | catalog items, articles |
| `kb_question` / `kb_answer` | `KBQ-` | title, body, author, accepted_answer_id, audience | open → new; answered → resolved; closed; removed → canceled | convert to article |
| `doc_collection` | — | name, kind {workspace, shared, personal}, owner_id, audience | active, archived | documents |
| `doc_document` / `doc_version` | `DOC-` | collection_id, title, file_id, mime, pages, language, owner_id, valid_to, review_at, ai_policy, extraction_state {pending, extracting, indexed, failed}, ocr, checksum | uploaded → new; indexing → active; indexed → active; superseded, retired → closed; failed → waiting | chunks, articles citing it |
| `kb_connector_source` / `kb_external_item` | — | kind {sharepoint, confluence, gdrive, onedrive, web, fileshare}, acl_mode {mirrored, managed, public, user_consent}, freshness_window, last_sync, counts, failures; item(external_id, url, acl_principals[], acl_keys, updated_at, hash) | active, paused, failed | `rag_chunk` |
| `rag_chunk` (owned by AI) | — | see AI data model; knowledge chunks copy the article/document keys and field group | — | article version, document page |

**Numbering prefixes:** `KB-` article, `KBS-` snippet, `KBT-` knowledge task, `KGP-` knowledge gap, `KBQ-` community question, `ATT-` attestation campaign, `DOC-` document. Numbers are tenant-scoped sequences; Persian digits in the UI, Latin digits in APIs.

**Access-scoping fields:**
- *Own*: `author_id` (drafts and WIP visible to the author), `kb_task.assignee_id` (assigned), subscriber and voter ids for personal views.
- *Group*: `owner_group_id`, `managed_by_group_ids` (contribute), approver groups of pending approvals (participant keys), `kb_task.group_id`.
- *Unit / company / location*: through audience bindings (`can_read`, `cannot_read`, `can_contribute`, `cannot_contribute`) compiled into keys (`o:`, `ot:`, `c:`, `ct:`, `lt:`, `g:`, `aud:`); content uses audience keys instead of requester anchors.
- *Domain*: `domain_id` (MSP customer domains, `dt:` keys).
- *Workspace*: `workspace_id` (secure HR/legal/security workspaces are restrictions, not grants).
- *Restrictions and fields*: `classification`, `external_visible`, internal sections (field class `internal`), `ai_policy` (read/extract/personas/channels), KCS audience × confidence matrix. Chunks, snippets, attachments and translations inherit the keys of their parent version.

### KPIs

| KPI | Formula | Notes / target |
|---|---|---|
| Link rate | closed records with ≥1 linked article ÷ closed records | KCS activity measure; no goal; 60–80% is enough to see patterns |
| Link accuracy | sampled links judged actionable, specific and relevant ÷ sampled links | KCS outcome measure; benchmark ≥ 90% |
| Reuse rate | records resolved by an existing article ÷ records with a linked article | healthy: internal reuse ≥ creation |
| Create rate (KCS) | (articles created − duplicates) ÷ create opportunities | PAR |
| Modify rate | articles modified ÷ reuses that warranted modification | PAR |
| Contribution Index | (valid created + modified + linked − duplicates) ÷ (create + modify opportunities + KB potential) | PAR, per contributor, coaching only |
| Participation rate | assisted records with a knowledge event (create, reuse, flag, modify) ÷ assisted records | KCS |
| Article Quality Index (AQI) | 100 − Σ(weighted defects) ÷ articles sampled | target ≥ 90% |
| Self-service use / success | % of users who try self-service first; % who find what they need (survey + behaviour) | KCS adoption goal ≥ 85% / ≥ 85% |
| Deflection rate | self-service sessions without a ticket on the same topic by the same user within 24–72 h (or "solved") ÷ sessions | JSM *Requests deflected*; ServiceNow VA deflection |
| Search success rate | searches followed by a click or accepted answer ÷ searches | ITIL; with click-through rate |
| Zero-result rate | searches with zero results ÷ searches | target < 10% |
| Freshness compliance | articles reviewed within their review period ÷ published articles; also % past review date, avg days since last review | ServiceNow, KCS |
| Time to publish | avg(published_at − created_at) | ITIL |
| 90/0 | articles external at or before the linked case's closure ÷ articles created | KCS mature target 90% |
| Helpfulness | helpful votes ÷ total votes; avg rating; views per article | — |
| Flag backlog / time to address | open flags; avg(task resolved_at − flag created_at) | KCS T6.4; flag-age SLA |
| Resolution uplift | MTTR and FCR of records with a linked article vs without | JSM *Requests resolved* |
| Knowledge-gap coverage | gaps covered in period ÷ gaps opened; Σ demand of open gaps | gap engine |
| Duplicate ratio | articles flagged duplicate ÷ published articles | KCS "unique" |
| AI grounding rate | AI answers citing ≥1 article/document ÷ AI answers | readiness score input |
| AI abstention rate | AI answers that abstained ÷ AI questions | high values feed gaps |
| AI draft acceptance | AI drafts published (after edits) ÷ AI drafts created; avg normalised edit distance | AI value |
| Translation coverage | articles with a validated translation in language L ÷ articles in master language | per language |
| Attestation compliance | users who acknowledged ÷ users in audience by due date | controlled documents |
| AI readiness score | f(coverage, freshness, usage, grounding) per category | TOPdesk-style |
| KM practice health (ITIL) | adoption, satisfaction with informational support, information quality audit results, tool adoption | ITIL practice metrics |

### Beyond the market

- **Persian-first search and AI**: letter and digit normalisation, half-space handling, Persian stemming, Finglish (Persian typed in Latin letters) transliteration, colloquial ↔ formal synonyms and officially approved Persian equivalents in the glossary. No leading tool does this; Jira Cloud has no native RTL at all.
- **Iranian document realities in smart documents**: Persian OCR for scanned letters; automatic extraction of letter number (indicator), Jalali date, issuing unit and subject from administrative letters and circulars (بخشنامه، آیین‌نامه، دستورالعمل); supersession chains so a newer circular automatically flags the older one and its dependent articles.
- **Contradiction detection across policies**: AI compares circulars and articles and reports conflicting instructions with citations before employees act on the wrong one.
- **Read-and-acknowledge on the org chart**: attestation campaigns targeted by the organisation tree (units, posts, locations) with reminders through Bale, Eitaa, Telegram or SMS gateways, Jalali due dates and Iranian holidays respected.
- **Knowledge through local messengers**: permission-safe answers and article links in Bale/Eitaa/Telegram/Rubika bots and short SMS answers, with identity bound to the user's account and one-time-code step-up.
- **Voice-to-knowledge capture**: Persian speech-to-text of voice notes and recorded sessions (including local web-conferencing recordings) turned into KCS drafts, capturing tacit knowledge that never gets typed.
- **Permission-exact offline knowledge** on the Windows app with optional local-model answers over the device replica only, for sites with unreliable connectivity or air-gapped networks.
- **Data sovereignty by default**: indexing, embeddings and answers can run entirely on tenant hardware; no vendor studied offers a fully local knowledge AI stack.
- **"Why can I see this?" on every citation**: each AI answer can explain, from the deterministic access trace, why each cited source is visible to the user.
- **Persian tone control**: drafting in formal administrative register vs friendly portal tone, which matters for official Iranian correspondence.

## Module: ai — هوش مصنوعی (مولد، پیش‌بین، گفت‌وگومحور، عامل‌محور، RAG و حاکمیت)

The AI module is the platform layer every other module uses: the tenant's own models (cloud or local) behind one gateway, permission-aware retrieval (RAG) over records, knowledge and documents, prompt-backed skills, tool-using agents that perform app operations, conversational front doors on every channel, smart reporting, predictions and insights, and the governance that keeps all of it inside the asking user's permissions. It merges every AI capability found in ServiceNow (Now Assist / Otto, AI Agents, Predictive Intelligence, AI Search, AI Control Tower), Atlassian (Rovo, Request Resolver, Ops Expert), Freshservice (Freddy Copilot, AI Agent, Insights, Agent Studio), BMC HelixGPT, ManageEngine Zia, Ivanti, SysAid, HaloITSM, TOPdesk, Xurrent, InvGate, Zendesk, OpenText SMAX, EasyVista, Zammad, the AI-native desks (Moveworks, Aisera, Atomicwork, Rezolve.ai, Leena AI, Siit) and AIOps tools (PagerDuty, BigPanda, Dynatrace, Datadog, Splunk ITSI), organised by capability family and mapped to the modules where each appears.

### Features

#### Capability families

| # | Family | Feature IDs | ITIL v5 6C capability | Main modules |
|---|---|---|---|---|
| 1 | Foundation: models, gateway, retrieval | AI-001 – AI-022 | all | all modules |
| 2 | Generative assistance | AI-023 – AI-040 | Creation, Clarification | incident, request, problem, change, release, csm, esm, security, project, slm |
| 3 | Predictive ML and NLP | AI-041 – AI-057 | Cognition, Curation | incident, request, problem, change, release, slm, workforce, csm |
| 4 | Conversational | AI-058 – AI-073 | Communication | portal, request, incident, esm, csm, integration |
| 5 | Agentic | AI-074 – AI-097 | Coordination | all; integration (MCP, A2A) |
| 6 | AIOps | AI-098 – AI-110 | Cognition, Curation, Coordination | event, incident, problem, continuity, workforce |
| 7 | Analytics and natural-language reporting | AI-111 – AI-121 | Clarification, Cognition | analytics, slm, service_portfolio, all dashboards |
| 8 | Knowledge and smart documents | AI-122 – AI-125, plus the AI features of the knowledge module: KB-012, KB-017, KB-023, KB-032–KB-034, KB-036, KB-037, KB-039, KB-041, KB-045–KB-047, KB-050–KB-053, KB-055, KB-057, KB-060–KB-062, KB-065–KB-082 | Creation, Curation, Clarification | knowledge, all |
| 9 | Asset and CMDB | AI-126 – AI-137 | Curation, Cognition | cmdb, itam, financial |
| 10 | Builder and admin | AI-138 – AI-152 | Creation, Clarification | admin, platform, access, request |
| 11 | Governance, safety and economics | AI-153 – AI-181 | (controls for all 6C) | ai, admin, access, security |
| 12 | Domain-specific | AI-182 – AI-190 | mixed | security, supplier, field_service, devops, workforce |

#### 1. Foundation: models, gateway and retrieval

**AI-001 · Bring-your-own model providers** — ارائه‌دهندگان مدل به انتخاب سازمان
- P0 · AI: yes · Family: Foundation · Modules: all (configured in ai/admin)
- Sources: ServiceNow (Now LLM and LTS models; certified Azure OpenAI, Gemini, Claude on AWS; BYOK Azure OpenAI, Google AI Studio, Bedrock; BYOLLM generic connector; spokes), BMC HelixGPT (HelixGPT Manager; GPT-4.1/5.x, Gemini 2.5 Flash, self-hosted gpt-oss-120b, Llama), ManageEngine (Zia LLM, ChatGPT, Azure OpenAI, Google AI Studio, Claude; BYOK per capability), Zammad (local LLMs via Ollama), Xurrent (bring OpenAI, Google, Anthropic or in-house models via MCP), Atlassian Rovo (model selection in Studio).
- What/how: Tenant admins register providers: OpenAI-compatible endpoints (OpenAI, Azure OpenAI, OpenRouter, Groq, Together, domestic OpenAI-compatible gateways, vLLM, Ollama, LM Studio), Anthropic and Google Gemini. Each has a base URL, an API key kept in the vault, region, data policy (zero retention, no training) and model list; "Test connection" lists models and probes capabilities. Several providers can coexist; in MSP mode keys can differ per domain. No vendor-hosted model is required.
- Build: `ai_provider`; adapters (OpenAI-compatible fetch + SSE, Anthropic SDK, Gemini SDK); secrets encrypted per tenant (AES-256-GCM).

**AI-002 · Model tiers and per-skill routing** — سطح‌بندی مدل‌ها و مسیریابی هر مهارت
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ServiceNow (small vs large model tiers per app, e.g. Claude Haiku 4.5 / GPT-5 mini vs Claude Sonnet 4.6 / GPT-5.4; per-use-case defaults; LTS models for stable behaviour), ManageEngine (provider chosen per GenAI capability), Atlassian Rovo (reasoning tier and model selection), BMC (certified model list per release).
- What/how: Every skill declares a tier: small (classification, extraction, short rewrites), large (multi-step reasoning, planning, long drafting), embedding, rerank, vision, stt, tts. Tenants map tiers to models and may override per skill, agent, workspace or domain; versions can be pinned for stable behaviour.
- Build: `ai_model_tier_map(tier, provider_id, model, fallback_chain[], scope)`; router inside the gateway; capability guard never routes a tool or vision skill to a model that lacks it.

**AI-003 · Sovereign local-model mode** — حالت حاکمیتی با مدل‌های محلی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: BMC (self-hosted gpt-oss-120b and Llama weights; the closest market example), Zammad (Ollama), ai.md ("no data leaves the network" tenant mode), access.md (local-model option; no training on tenant data).
- What/how: One tenant switch pins every tier, embeddings and reranking included, to local endpoints (Ollama, vLLM, LM Studio, TGI) and disables web search, cloud connectors and cloud translation. The admin console shows which features work with the local models' capabilities (tool calling, vision, context length). Works for on-premises, air-gapped and offline Windows deployments.
- Build: gateway policy flag; capability self-test (AI-020); constrained-JSON ReAct fallback for models without native tool calling; local embedding and rerank models.

**AI-004 · Resilience: fallback chains, retries, circuit breakers** — پایداری: زنجیره جایگزین، تلاش مجدد و قطع‌کننده مدار
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ai.md (fallback chain on 429/5xx with jittered backoff; circuit breaker per provider; capability guard), existing platform job engine (rate limits pause only the affected connection or model).
- What/how: Each tier has an ordered fallback chain. A 429 pauses only that connection and model (honouring Retry-After); 5xx errors retry with jitter; an open circuit skips a failing provider; sovereign mode never falls back to the cloud. Per-provider concurrency limits and a health page.
- Build: gateway middleware; `RateLimitError` / `DeadlineError` semantics in job lanes; provider health table.

**AI-005 · AI gateway (one egress for every model call)** — دروازه واحد هوش مصنوعی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ServiceNow (Generative AI Controller: routes every LLM call; flow actions and APIs; Data Privacy masking; generative AI log), ITIL (AI gateway enforcing enablement, data-classification rules, PII redaction, routing, prompt versioning, budgets, logging, kill switches), JSM (one gateway with metering and an exportable audit log), BMC (HelixGPT Manager).
- What/how: Skills, agents, retrieval, embeddings and classifiers all call one service. It checks feature enablement (tenant, workspace, user), invocation permission, AI-channel policy and field classes of the context, masks personal data, screens for injection, routes by tier, enforces budgets and rate limits, then logs the call (redacted or hashed inputs, output, tokens, cost, latency, guard verdicts). Flows and scripts use it through "LLM actions": summarise, translate, generate, classify, extract, answer.
- Build: gateway module; `ai_invocation` log; policy hooks; streaming.

**AI-006 · Skill framework (skills as data)** — چارچوب مهارت‌های هوش مصنوعی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ServiceNow (Now Assist skills and admin console: provider/model, triggers, roles, output target and languages per skill; "duplicate to customise"; Now Assist Skill Kit with typed inputs, prompt templates, tests, versions, deployment as UI action, flow action, panel skill or agent tool), BMC (GPT configuration record definitions), ManageEngine (provider per capability), Freshservice (Copilot capabilities enabled per role), HaloITSM (AI Ability: prompt step mapping variables to JSON outputs).
- What/how: A skill is a record: inputs (field bindings, related lists, retrievers, scripts) with a character budget, a versioned prompt template, model tier, JSON output schema, target (field, work note, panel, suggestion card, notification variable), triggers (UI action, context menu, condition rule, schedule, events such as assignment change or resolve, end of chat), invocation audience, auto-apply policy, confidence thresholds, PII policy and languages. Built-in skills are read-only; admins duplicate to customise. Custom skills are tested on sample records before activation.
- Build: `ai_skill`, `ai_prompt_version`; skill runner in the gateway; triggers on the rule engine; UI bindings generated from metadata.

**AI-007 · Prompt studio, versioning and custom instructions** — استودیوی پرامپت، نسخه‌بندی و دستورالعمل سفارشی
- P1 · AI: yes · Family: Foundation · Modules: ai, admin
- Sources: ServiceNow (Skill Kit prompt versioning; Auto-Evaluation), BMC (prompt extensions with organisation terms, 26.2; HelixGPT Admin role), Freshservice (Copilot agentic configuration: admin instructions), Atlassian Rovo Studio (instructions), Aisera (Prompt Studio).
- What/how: Edit prompts with variables, test against sample records side by side across models, estimate tokens and cost, diff and roll back versions, shadow-run a new version before switching. Tenant-wide custom instructions (tone, terminology, banned phrases, house style) apply to all skills, and the glossary is injected.
- Build: `ai_prompt_version(state draft|testing|active|retired)`; evaluation gate AI-170; change control AI-174.

**AI-008 · Permission-aware context builder** — سازنده زمینه با رعایت دسترسی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ai.md (context builder), access.md (field classes, persona pinning, context pinning), Freshservice (prompt over a permission-filtered context), JSM (Resolve with Rovo generated with the viewer's permissions), BMC (agentic AI pinned to the ticket's customer company).
- What/how: Loads the record with the caller's row and field permissions; adds journal entries in time order with quoted replies, signatures and duplicate system notes stripped; adds the related records the skill declares (SLA, CIs, child incidents, approvals) only if readable; pins to the record's domain or company in MSP mode; pins the persona (a requester-facing skill never sees internal notes); fits the token budget by keeping the newest entries verbatim and a rolling summary of older ones.
- Build: shared library used by every skill; rolling summary per record, updated incrementally.

**AI-009 · Permission-aware retrieval (early and late binding)** — بازیابی با رعایت دسترسی (اتصال پیشین و پسین)
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ServiceNow AI Search (early binding compiles security filters into the query; late binding `canRead()` per hit; external content keeps source permissions through aliases; Genius Results only on accessible content), BMC HelixGPT (ACL check before context is returned; unviewable chunks never reach the LLM; tenant-separated vector store), Moveworks (mirrored ReBAC pre-filter plus ABAC post-filter), Glean (permission-filtered context pool), Microsoft 365 Copilot (permission trimming), Atlassian Rovo; OWASP LLM08 (vector and embedding weaknesses).
- What/how: Vector and keyword queries carry the subject's compiled predicate (access keys, tenant, domain, classification, AI-channel flags) in the WHERE clause; results are over-fetched (about 3× N) and the top hits are re-checked by the record-level evaluator before anything reaches the prompt. Counts are never shown from the pre-filter; field groups the subject cannot read are never retrieved; requester personas never retrieve internal notes.
- Build: `rag_chunk` with `acl_keys`; `ORDER BY embedding <=> $q` plus the predicate; evaluator re-check; persona and domain pinning.

**AI-010 · Ingestion, chunking and vector index** — دریافت، قطعه‌بندی و نمایه برداری
- P0 · AI: yes · Family: Foundation · Modules: knowledge, all record modules
- Sources: ServiceNow (AI Search RAG 6.1.0 small-to-big default), BMC (per-tenant OpenSearch vector index; unpublished articles removed; chunk size and overlap per semantic index, 26.3.01), ai.md (heading-aware chunks of 300–800 tokens with 10–15% overlap and title/breadcrumb prefix; AI-written resolution digests for tickets), access.md (chunks per field group with their own keys).
- What/how: Sources are articles, snippets, documents, catalog items, resolved records (indexed as an AI-written resolution digest: symptom, cause, fix), service and CMDB descriptions and connector items. Chunking is structure-aware (lists and tables kept whole), small-to-big (150–250-token child chunks that return the parent section), configurable per source; chunks are deleted on unpublish, retire or delete; changing the embedding model creates a new index version and re-embeds in the background; restricted departments and MSP domains get separate partitions.
- Build: ingestion jobs (system lane) and embedding jobs (llm lane); pgvector HNSW; `rag_index_version`.

**AI-011 · Hybrid retrieval, query rewriting and re-ranking** — بازیابی ترکیبی، بازنویسی پرسش و رتبه‌بندی مجدد
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ServiceNow (hybrid lexical plus semantic retrieval), ai.md (BM25 and kNN in parallel; reciprocal rank fusion k≈60; glossary-based query rewriting; multi-query; cross-encoder reranking top 50 → 6–8; recency decay for operational content; expired content excluded).
- What/how: Persian-aware BM25 and vector search run in parallel, both pre-filtered, then merge by reciprocal rank fusion. Queries are rewritten (spelling, acronyms, glossary terms, Finglish transliteration) and expanded into several sub-queries when vague. A cross-encoder or small LLM re-ranks. Freshness rules exclude expired content and retired CIs or products, decay old operational content (outages, known errors) and leave policies undecayed.
- Build: retrieval service; rerank tier; per-surface parameters.

**AI-012 · Grounded generation with citations and abstention** — تولید مستند با ارجاع و امتناع از پاسخ
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ServiceNow (Genius Results with citations; triage agent writes "Not determined" when unsure), JSM (Request Resolver cited resolution plans), Freshservice (citations and grounding), ITIL v5 (with insufficient information the AI declines rather than invents), ai.md (citation verification by NLI or an LLM verifier; unsupported sentences dropped).
- What/how: Answers use only the provided passages and cite them as [n]. Below a calibrated retrieval-score threshold the assistant abstains and offers a next step ("shall I open a request?"). Each cited sentence is verified against its passage; unsupported sentences are dropped or regenerated; numbers may come only from provided facts.
- Build: generation templates; verifier skill; abstention thresholds per surface; `ai_abstain` events.

**AI-013 · Citation re-authorisation and ACL-fingerprint caching** — بازمجوزدهی ارجاع‌ها و کش وابسته به دسترسی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: access.md (re-check citations at render; no hidden-source hints; cache keyed by ACL fingerprint), JSM (AI outputs cached per item and viewer permissions, ≤7 days), ai.md (never serve cached answers across ACL fingerprints).
- What/how: Every citation is re-checked against the viewer's live permissions when rendered; failing ones are dropped silently (no "3 hidden sources" hint). Caches are keyed by tenant, ACL fingerprint, normalised query, source versions, prompt version and model; a semantic cache is never shared between users unless every source is public; TTLs are short.
- Build: gateway cache; per-user `authz_epoch` for invalidation.

**AI-014 · Index freshness as a security property** — تازگی نمایه به‌عنوان الزام امنیتی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: access.md (re-key chunks in the same transaction or mark them stale; nightly reconciliation), Atlassian Rovo (connector freshness window; stale permissions handled conservatively), Moveworks (event or ~15-minute permission refresh), BMC (permission changes "immediately synced").
- What/how: When an access anchor changes (assignment group, security level, company, restricted flag, audience binding), affected chunks are re-keyed in the same transaction through an outbox, or flagged stale and excluded until re-keyed. Connectors declare a freshness window and fail closed when sync is late. A nightly job reconciles chunk keys with record keys and reports drift.
- Build: outbox triggers; `stale` flag; reconciliation job; admin health page.

**AI-015 · Enterprise connectors with mirrored permissions** — اتصال‌دهنده‌های سازمانی با آینه‌سازی دسترسی
- P1 · AI: yes · Family: Foundation · Modules: knowledge, portal, integration
- Sources: Moveworks (mirrored, managed and user-consent permissions; Data Ingestion View; next-generation connectors 2026), ServiceNow (AI Search external content connectors with identity aliasing), Atlassian (Teamwork Graph connectors: Google Drive, SharePoint, Slack, GitHub and others), Freshservice (SharePoint, Google Drive, Confluence, URLs; SharePoint sync insights with file-level failures and CSV export), InvGate (SharePoint libraries synced every 3 hours respecting group permissions), Glean, ManageEngine (Confluence extension; SharePoint as an Ask Zia source), SysAid (URLs in the Data Pool).
- What/how: Connectors for SharePoint/OneDrive, Confluence, Google Drive, SMB file shares, web crawls (sitemap, depth, include/exclude rules), Nextcloud and other ITSM knowledge bases. Each captures source ACL principals and maps identities through aliases; delta sync uses webhooks or delta APIs with periodic full re-sync. ACL modes: mirrored, managed rules (attributes of users and content), public, or user-consent live search with the user's own OAuth token. Sync insights show status, item counts and failures with reasons (CSV export); each source has its own AI policy.
- Build: `kb_connector_source`, `kb_external_item`, identity alias table; connector jobs (external lane).

**AI-016 · Persian and multilingual language layer** — لایه زبان فارسی و چندزبانه
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ai.md (multilingual embeddings for mixed Persian and English tenants), analytics_ux (Persian normalisation; Persian NLP for routing and deflection; formal/informal tone; Persian↔English), ServiceNow (languages per provider; native vs dynamic translation), Zendesk (80 text languages), ManageEngine (Zia predictions in 25 languages).
- What/how: Shared Persian text services: normalisation, half-space-aware tokenisation, stemming, Finglish transliteration, Persian digits, and Jalali date expressions ("پارسال", "سه ماه اخیر", "هفته قبل از نوروز") parsed into date ranges. Language detection, a multilingual embedding model, per-language prompt templates, a reply-in-the-user's-language policy and Persian evaluation sets for every skill.
- Build: text-services library; Jalali calendar and holiday service; per-language model evaluation.

**AI-017 · Context graph grounding** — زمینه‌سازی با گراف ارتباطات
- P1 · AI: yes · Family: Foundation · Modules: cmdb, incident, change, event, problem
- Sources: ServiceNow (Knowledge Graph and Context Engine, also exposed as an MCP tool), Atlassian (Teamwork Graph), Atomicwork (Universal Context), BigPanda (IT Knowledge Graph), BMC (knowledge graph in AIOps root-cause isolation).
- What/how: A queryable graph of people, groups, records, CIs, services, assets, changes and articles (from CMDB relationships, record links and ownership) that agents traverse for grounding, such as "who owns the service this CI supports?" or "changes on upstream CIs in the last 24 hours", always through the access layer and with depth limits.
- Build: graph views over relational tables (recursive CTEs, closure tables); traversal tools.

**AI-018 · Suggestion lifecycle and output targets** — چرخه عمر پیشنهاد و مقصدهای خروجی
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ai.md (every output is a suggestion unless auto-apply is allowed; accept/edit/reject; edit distance as the main online metric), ServiceNow (AI Lens gradient marker on AI-filled fields until edited; "Share as work notes"), Freshservice (agents approve or ignore recommendation cards).
- What/how: Outputs arrive as suggestions (field chips, a draft in the composer, a card in the panel) with Accept, Edit and Reject, or are applied automatically when the skill policy and confidence allow it. Applied values keep the invocation id and an AI marker until a person edits them; acceptance and normalised edit distance are recorded.
- Build: `ai_suggestion`; shared UI components; metrics feed AI-172.

**AI-019 · Background AI jobs and streaming** — کارهای پس‌زمینه هوش مصنوعی و پخش تدریجی پاسخ
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: ai.md (bulk and background skills on a job queue with per-provider rate limits; interactive skills stream), existing platform job engine (job lanes, fair claiming per lane and owner, step budgets).
- What/how: Background work (classification at create, sentiment refresh, clustering, gap detection, digests, embeddings, agent steps) runs as jobs in an `llm` lane claimed fairly per tenant and connection; long steps checkpoint and continue on the next tick; rate limits pause only the affected connection or model. Interactive skills stream tokens to the UI and can be cancelled.
- Build: jobs with lanes; handlers return continue, wait, done or fail; server-sent events.

**AI-020 · Model onboarding: capability probe and evaluation gate** — آزمون قابلیت مدل و دروازه ارزیابی
- P1 · AI: yes · Family: Foundation · Modules: ai, admin
- Sources: ai.md (probe `/v1/models`; capability self-test for JSON mode, tool calling and context length; a model is enabled for a skill only after the skill's golden set passes), BMC (certified models; streaming disabled for some), ServiceNow (certified third-party models).
- What/how: Adding a model runs a self-test (JSON-schema adherence, tool calling, vision, context length, Persian quality, latency) and stores a capability matrix. A model can serve a skill only after that skill's golden set passes on it; the console shows "certified for" badges per skill.
- Build: test harness; capability matrix in `ai_provider.models[]`; link to AI-170.

**AI-021 · AI surfaces everywhere (UX contract)** — حضور یکپارچه هوش مصنوعی در رابط کاربری
- P0 · AI: yes · Family: Foundation · Modules: all
- Sources: analytics_ux (six AI surfaces: summary card, inline composer actions, side panel, natural language in lists/queues/reports, chat front doors, Slack/Teams), ServiceNow (Now Assist panel, context menu, AI Lens, agentic processes tab), Freshservice (Freddy panel), JSM (Resolve with Rovo panel at the top of the work item), Zammad (live AI-presence avatar), SysAid (hover summary in queues).
- What/how: Fixed placements across the product: an AI summary card at the top of each record; composer actions (draft, improve, translate); a right-side assistant panel; a natural-language box in lists, queues and reports; the Ctrl+K command bar; chat front doors in the portal, the Windows app and messengers; an AI-presence indicator when an agent is working on a record; hover summaries in lists. Same Persian labels and icon everywhere; AI content is always labelled.
- Build: shared UI components; each surface enabled from the control centre (AI-153).

**AI-022 · Speech services (Persian STT and TTS)** — خدمات گفتار فارسی (تبدیل گفتار و متن)
- P1 · AI: yes · Family: Foundation · Modules: portal, incident, csm, event, knowledge
- Sources: ServiceNow (voice input in the panel; AI Voice Agents), BMC (Employee Navigator voice input), ManageEngine (Ask Zia voice), Zendesk (voice AI agents in 53 languages), PagerDuty (Scribe transcription).
- What/how: Speech-to-text for voice input in the panel and portal, voice notes received from messengers, and recorded calls and meetings; text-to-speech for voice replies; Persian-capable local or cloud models; transcripts stored on the record and governed like any text.
- Build: `stt` and `tts` tiers in the router; audio in the file store; transcription jobs.

#### 2. Generative assistance

**AI-023 · Record summarisation (state-aware, sectioned)** — خلاصه‌سازی رکورد بر پایه وضعیت
- P0 · AI: yes · Family: Generative · Modules: incident, request, problem, change, release, csm, esm, security, field_service, cmdb, itam, project, supplier
- Sources: ServiceNow (incident summary with sections Issue, Key Actions Taken, Resolution, Affected CIs and Impacted Services, SLA, Child Incidents, mandatory by state; triggered by the Assign modal; "Share as Work notes"; change, request, CI, asset, security incident (chronological, recent-weighted), HR and employee-relations case, TPRM and risk summaries), Freshservice (Ticket Summariser, automatic on close when the conversation has more than one message), BMC (incident summary; Service Collaborator), JSM (Summarize work items), Ivanti (Business Object Summarization for any object, custom ones included), InvGate (one-click summary postable as an internal comment), TOPdesk (AI Summarization: issue, solutions tried, status), Zendesk (custom summaries per team), ManageEngine (Conversation Summary up to 90,000 characters), SysAid (hover summary), Zammad (intent, summary, open questions, events, sentiment).
- What/how: A summary template per record type with sections, some mandatory by state. Triggers: on demand; on assignment change (hand-off briefing); on first open by a new assignee when the last summary is over 30 minutes old; on close; on hover in lists. Output goes to the panel, a card or a work note; summaries cite related records. Any record type in the metadata engine gets a default template from its fields. Requester-facing summaries exclude internal notes.
- Build: template per record type generated from metadata; rolling summary cache invalidated on change; triggers on assignment events.

**AI-024 · Conversation, call and swarm summarisation** — خلاصه گفت‌وگو، تماس و اتاق همکاری
- P1 · AI: yes · Family: Generative · Modules: incident, csm, event, portal, workforce
- Sources: ServiceNow (chat summary into the interaction or incident; Sidebar discussion summary saved to work notes), BMC (Ops Swarmer: channel summaries, participant timelines in Teams), JSM (private AI catch-up when a responder joins the incident channel; timeline proposed after resolution), PagerDuty (Scribe: call and chat transcription and summaries), Freshservice.
- What/how: Summaries of chat transcripts, swarm or war-room channels (in-app collaboration and messenger groups), recorded calls (through speech-to-text) and meetings. "Catch me up" for late joiners gives status, severity, owner, affected services, key decisions and open questions; results are saved to the record timeline.
- Build: transcript ingestion (AI-022 for audio); summarisation skill; timeline entries.

**AI-025 · Resolution notes generation** — تولید یادداشت حل
- P0 · AI: yes · Family: Generative · Modules: incident, request, csm, field_service
- Sources: ServiceNow (on demand or automatic on resolve; Shorten and Elaborate), BMC (summarised resolution notes on resolve or close, editable and undoable), Freshservice (Resolution Notes Generator), ManageEngine (generated resolutions).
- What/how: On resolve, drafts resolution notes (symptom, cause, steps taken, verification) from the record history for the agent to edit. It also writes the resolution digest used for similarity search and knowledge drafting.
- Build: skill on the resolve transition; digest stored for retrieval.

**AI-026 · Reply drafting and response recommendations** — پیش‌نویس پاسخ و پیشنهاد پاسخ
- P0 · AI: yes · Family: Generative · Modules: incident, request, problem, csm, esm
- Sources: ServiceNow (activity response recommendation: Summarize actions, Post response, Follow up, Acknowledge task; email and chat reply recommendation in CSM and HR), JSM (Suggest reply from KB articles and similar resolved items; contextual pills Follow up, Request more info, Propose closure based on wait time, SLA and assignment; Enhance reply), Freshservice (Reply Suggester; Multilingual Reply Suggester), Zendesk (Copilot suggested replies; auto assist following procedures), TOPdesk (Answer Assistant grounded in the KB), ManageEngine (Reply Assist), Ivanti (Email Assist), SolarWinds (AI tone enhancer turns shorthand into a polished reply), Alemba (AI-drafted e-mails).
- What/how: Drafts a reply in the composer from the record, the knowledge base and similar resolved items, in the requester's language and the tenant's tone. Quick intents (acknowledge, ask for information, propose closure, follow up) are suggested from state, wait time and SLA; "enhance" expands a short instruction. Article citations become links. Nothing is sent automatically, and the public/internal safety check applies.
- Build: skill with knowledge retrieval; composer integration; tenant tone instructions.

**AI-027 · Writing assistant on every text field** — دستیار نگارش روی همه فیلدهای متنی
- P0 · AI: yes · Family: Generative · Modules: all
- Sources: ServiceNow (context menu: summarize, shorten, elaborate, tone casual/formal/sympathetic, create or edit a KB article; several configurations per field, show/hide conditions, extended tables; ACL on context-menu skills), Freshservice (Writing Assistant), TOPdesk (Writing Assistant), SysAid (AI Author), Zammad (expand, fix, halve, simplify, custom tools), Ivanti (Write Assist), ManageEngine (Writing Assistant), Zendesk.
- What/how: A context menu on rich and long text fields: improve, fix spelling and grammar, shorten, expand, simplify, summarise, change tone (formal administrative Persian, neutral, friendly, sympathetic), translate, and admin-defined custom tools. Configurable per field and record type with conditions; results are editable suggestions with undo.
- Build: generic skill set bound by field type from metadata; ACL per action.

**AI-028 · Translation of records and conversations** — ترجمه رکوردها و گفت‌وگوها
- P1 · AI: yes · Family: Generative · Modules: incident, request, csm, esm, knowledge, portal
- Sources: ServiceNow (Dynamic Translation and language detection), Freshservice (Translator; multilingual replies), TOPdesk (whole ticket into the operator's language), Ivanti (field-level and workbench translation; OpenAI, Google, DeepL or Azure engines), HaloITSM (portal translation with Azure AI Translator), Zendesk (80 languages), BMC (real-time knowledge translation).
- What/how: Detects the language of incoming text, translates it into the agent's language and translates replies back into the requester's language. Inline per-field translation keeps the original. The engine is chosen per tenant (LLM, MT engine or local model) and uses the glossary.
- Build: translation abstraction; original and translated text stored side by side.

**AI-029 · Post-incident review and major incident report generation** — تولید گزارش بازبینی پس از حادثه
- P1 · AI: yes · Family: Generative · Modules: incident, problem, event, security
- Sources: Freshservice (Post Incident Report Generator: symptoms, root cause, impact, diagnosis, resolution, prevention, action items), BMC (Major Incident Report generation, 26.1; PIR publishing and localisation, 26.2–26.3), JSM (PIR summary; Ops Expert creates a PIR from incident channel data; ICC compiled PIR), ServiceNow (Generate post-incident reviews agent), ManageEngine (PIR Generator), Xurrent (Sera Recap), standards (postmortem drafting with blameless-language linting).
- What/how: Builds a PIR draft from the timeline, work notes, communications, linked changes and actions, in configurable sections, with a blameless-language check. Action items become problem tasks with owners and due dates once confirmed.
- Build: skill with timeline assembly; task proposals; PIR template.

**AI-030 · Major-incident and stakeholder communications** — ارتباطات حادثه عمده و ذی‌نفعان
- P1 · AI: yes · Family: Generative · Modules: incident, event, continuity, portal
- Sources: ServiceNow (Major Incident email content recommendation: Gen-AI variables filled from record, SLA and collaboration data), JSM (ICC communication drafts; Ops Expert stakeholder updates), PagerDuty, standards (executive updates).
- What/how: Drafts updates per audience (executives, affected users, technical teams, status page) on a cadence from current facts: impact, workaround, ETA, time of next update. Persian and English; tone and length per audience; a person approves before sending.
- Build: notification templates with AI variables; update-cadence timer.

**AI-031 · Root-cause analysis and problem statement drafting** — پیش‌نویس تحلیل علت ریشه‌ای و شرح مسئله
- P1 · AI: yes · Family: Generative · Modules: problem, incident, security, event
- Sources: ManageEngine (RCA by Zia: contributing factors, corrective and preventive actions; PIR and RCA generation), BMC (Problem Coordinator 5 Whys; RCA records with AI-assisted 5-Why chains, 26.3 CA), Xurrent (Sera Recap), Freshservice (Resolution insights), JSM (probable root cause from PIR history), ITIL v5 (automated root cause analysis).
- What/how: Structured output: symptoms, timeline, hypotheses with evidence references and confidence, a 5-Whys chain, contributing factors (people, process, technology, supplier, environment), workaround, permanent-fix options and action items. Every claim cites at least one record; weak evidence produces "insufficient evidence".
- Build: JSON-schema skill; evidence retrieval; review UI.

**AI-032 · Change narratives (summary, risk explanation, CAB pack)** — روایت تغییر: خلاصه، توضیح ریسک و بسته CAB
- P1 · AI: yes · Family: Generative · Modules: change, release
- Sources: ServiceNow (change summarisation with state-dependent sections; change risk explanation citing the fired risk condition, similar changes and their incidents), JSM (Prevention Center change summary: current vs proposed state), BMC (CAB Supervisor readiness summary), ITIL (CAB briefing summaries).
- What/how: State-aware summaries (objective, plan, risk, affected CIs, impacted services, close notes, incidents caused). The risk explanation narrates only the computed factors. The CAB pack compiles summary, risk, conflicts and readiness for every change on the agenda.
- Build: skills over the change record; CAB agenda generation.

**AI-033 · Implementation, backout and test plan drafting** — پیش‌نویس برنامه اجرا، بازگشت و آزمون
- P1 · AI: yes · Family: Generative · Modules: change, release, devops
- Sources: ServiceNow (generate change plans: implementation, backout and test plans, risk and impact analysis, justification), Freshservice (Test Case Generator), ITIL and standards (plans drafted from similar past changes).
- What/how: Drafts plans from similar successful changes, standard-change templates, CI runbooks and vendor documents. A plan-quality rubric (present, specific, verifiable) scores existing plans and feeds change risk prediction.
- Build: similar-change retrieval; rubric skill; suggestions.

**AI-034 · Release notes generation** — تولید یادداشت انتشار
- P1 · AI: yes · Family: Generative · Modules: release, devops, portal
- Sources: ServiceNow (release notes generation), Atlassian Rovo (Release Notes Drafter: up to 20 work items into themed notes), ITIL v5.
- What/how: Collects linked changes, stories and pull requests, classifies each as feature, fix, security or breaking, and writes per-audience variants (end-user Persian, technical). Every line cites its source item.
- Build: skill bound to the release record.

**AI-035 · Service, SLA and management review narratives** — روایت گزارش‌های بازبینی خدمت، SLA و مدیریت
- P1 · AI: yes · Family: Generative · Modules: slm, supplier, financial, analytics, csm, continuity
- Sources: ai.md (service review packs: LLM narrative over deterministic metrics), standards (SLA/XLA report drafting with drivers; management review packs citing figures), HaloITSM (QBR packs; AI report summaries with next steps), ITIL (SLA report narratives).
- What/how: Metrics are computed deterministically; the LLM writes what changed, why (drivers from the insight engine) and the agreed actions, for service reviews, supplier QBRs, management reviews and chargeback. Every number must come from the supplied tables, which a validator checks.
- Build: report engine plus narrative skill with a number-check validator.

**AI-036 · Project status reports and RAID extraction** — گزارش وضعیت پروژه و استخراج ریسک‌ها و مسائل
- P2 · AI: yes · Family: Generative · Modules: project, esm
- Sources: ServiceNow (AI project status reports: health, executive summary, rationale; Identify Project Risks saved as AI drafts; MCP for SPM), standards (schedule-slip prediction; RAID extraction from meeting notes), Atlassian Rovo (status updates).
- What/how: The red/amber/green status comes from deterministic thresholds; the LLM drafts the executive summary and rationale from those facts. Risks, issues and decisions extracted from comments and meeting notes are saved as drafts for the project manager.
- Build: skill; draft records.

**AI-037 · Document generation from templates** — تولید سند از روی قالب
- P2 · AI: yes · Family: Generative · Modules: esm, continuity, security, supplier, request
- Sources: ITIL (document generation, e.g. employment letters), ai.md (BIA and DR plan drafting with citations and explicit TODOs), standards (draft BIA from CMDB dependencies, human-approved).
- What/how: Template-driven documents (letters, certificates, BIA and DR plans, policy drafts) filled from records with citations; unknowns stay as explicit TODOs; the owner attests before publishing; official Persian letter layout supported.
- Build: document templates; skill; approval step.

**AI-038 · Checklist and task generation** — تولید چک‌لیست و وظایف
- P2 · AI: yes · Family: Generative · Modules: request, change, project, incident
- Sources: ManageEngine (Checklist Generator), ServiceNow (user story and acceptance criteria generation).
- What/how: Proposes a checklist or task breakdown for a request, change or project from its description and similar past records; the agent accepts items into tasks.
- Build: skill; task proposals.

**AI-039 · Screenshot, image and video understanding** — درک اسکرین‌شات، تصویر و ویدئو
- P1 · AI: yes · Family: Generative · Modules: incident, request, portal, field_service, itam
- Sources: Freshservice (image support: extracts information from screenshots and images), ServiceNow (Vision AI Agent: images and video up to 500 MB; attachment summarisation for JPEG/PNG), OpenText SMAX (Smart Ticket: OCR of screenshots and e-mails), JSM (Request Resolver reads attachments and screenshots with OCR), ManageEngine (Ask Zia image input), BMC (Employee Navigator image input), ITIL (image recognition of asset labels and serials).
- What/how: Extracts error codes, messages, application names and device or serial details from screenshots and photos (Persian and English OCR), suggests category and fields, and lets field technicians photograph labels to fill asset data.
- Build: vision tier; OCR; extraction schema per use case.

**AI-040 · E-mail understanding and e-mail commands** — درک ایمیل و فرمان‌های ایمیلی
- P1 · AI: yes · Family: Generative · Modules: incident, request, platform
- Sources: ManageEngine (Zia reopen validation ignores thanks and out-of-office replies; Zia Parser "@ZIA" e-mail commands; GenAI processing of acknowledgement replies; e-mail approval replies interpreted by Zia, ChatGPT or Azure OpenAI), BMC (follow-up response screening ignores pure acknowledgements; analysis of why an incident went Pending), Freshservice (Email Bot intent detection), JSM (bulk triage of "Emailed request").
- What/how: Classifies inbound mail as new issue, reply, acknowledgement, auto-reply or approval answer; stops needless reopening or status changes; extracts fields; interprets free-text approval replies (e.g. «موافقم») with a confirmation step; optional command syntax lets agents update tickets by e-mail.
- Build: small-tier classifier; e-mail engine hooks.

#### 3. Predictive ML and NLP

**AI-041 · Field classification and auto-triage at creation** — طبقه‌بندی خودکار فیلدها و تریاژ هنگام ثبت
- P0 · AI: yes · Family: Predictive · Modules: incident, request, problem, change, csm, esm, security, service_portfolio
- Sources: ServiceNow (Predictive Intelligence classification; Task Intelligence; triage agent sets service, offering and CI), ManageEngine (Zia: category/subcategory/item, template, priority, technician, group; top-3 suggestions; optional auto-apply; 25 languages; 500-request minimum history), Freshservice (Field Autofill Suggester), Ivanti (ticket classification and routing), SysAid (Intelligent Categorization with escalation rule), TOPdesk (AI Triage: category, priority, operator group), InvGate (category and priority), Zendesk (intelligent triage: intent, entities, sentiment, language), BMC (auto-categorisation and group prediction; intelligent service prediction; Ticket Resolver urgency and impact), JSM (Request Router; bulk Triage of request types), OpenText SMAX (Smart Ticket ML classification), monday service; ITIL 4 (part-automatic classification).
- What/how: On creation through any channel, predicts category tree, service and offering, CI, urgency, impact and priority, assignment group, template or request type, each with confidence. Top-3 chips; auto-apply above the tenant's precision threshold, suggestion in the middle band, "Not determined" below. Per-tenant classic models (embeddings or TF-IDF plus logistic regression) trained on resolved history, with an LLM fallback for cold start; works on Persian text. Bulk triage re-types mis-filed items (such as generic e-mailed requests) only when every required field of the new type can be filled.
- Build: `ml_model` per field; `ai_suggestion`; create trigger in the llm lane; per-class thresholds.

**AI-042 · Similar records and suggested resolutions** — رکوردهای مشابه و راه‌حل پیشنهادی
- P0 · AI: yes · Family: Predictive · Modules: incident, request, problem, change, csm, event
- Sources: ServiceNow (PI similarity; suggested steps from similar closed incidents over 6 months), Freshservice (Similar Incident Suggester; Resolution insights with likely cause and fix steps; Similar Change Suggester), Zendesk (similar tickets), InvGate (similar open and closed requests at creation), JSM (Similar requests panel; related resources), HaloITSM (vector-based ticket matching), BMC (resolution insights from clustered past incidents; similarity-based agentic search), ManageEngine (Resolution Assist), SolarWinds (guided incident resolution).
- What/how: A panel lists similar open and resolved records with their resolution digests, shared CIs and dates, and synthesises suggested steps with citations. Filters: open or resolved, period, same service. Ranking = embedding score × structural signals (shared CI or service, time proximity); thumbs feedback improves it.
- Build: retrieval over resolution digests; ranking features; feedback table.

**AI-043 · Duplicate detection** — کشف رکورد تکراری
- P1 · AI: yes · Family: Predictive · Modules: incident, request, portal
- Sources: Zendesk (Intelligence panel lists tickets from the same requester up to two weeks before or after), BMC (no duplicate incidents from the same e-mail thread), ai.md (portal duplicate check at cosine ≥ 0.9).
- What/how: Flags likely duplicates (same requester within ±14 days, same service with high similarity, same e-mail thread) and proposes a merge or parent/child link; an agent confirms; merging keeps both histories.
- Build: similarity job on create; merge action.

**AI-044 · Spike clustering and major-incident detection** — خوشه‌یابی جهش‌ها و کشف حادثه عمده
- P1 · AI: yes · Family: Predictive · Modules: incident, event, problem
- Sources: ServiceNow (AI-driven incident clustering; similar incidents proposed as major-incident children), InvGate (Major Incident Detection notifies coordinators), Ivanti (incident correlation flags potential major incidents), standards (early major-incident detection from ticket bursts), ai.md (sliding 60-minute window; edges at cosine ≥ 0.82, or ≥ 0.70 with a shared CI or service; ≥5 incidents from ≥3 callers; Poisson p < 0.01 against the hourly baseline).
- What/how: New incidents are clustered in a sliding window. When a burst is significant against the service's baseline, the system proposes a major incident with an LLM-written title and description and the candidate children, and notifies the major-incident coordinator; a person confirms before anything is linked.
- Build: streaming job; per-service baselines; proposal record.

**AI-045 · Problem candidate detection** — کشف نامزدهای مسئله
- P1 · AI: yes · Family: Predictive · Modules: problem, incident, analytics
- Sources: BMC (Problem Solver 26.2.01 with a conversational console over clusters; ITSM Insights proactive problem management with k-means), ManageEngine (Zia Cluster Analysis with thresholds, execution rules and notifications; Problem Technician Prediction), InvGate (Common Problem Detection), ServiceNow (PI clustering), Ivanti (incident correlation with boundary and keyword exclusions), HaloITSM (ticket clustering with AI-written description and resolution), OpenText SMAX (Hot Topic Analytics), SolarWinds (AI Incident Correlation), ITIL v5 (pattern detection), standards (nightly HDBSCAN; a human creates the problem).
- What/how: Nightly clustering of 30–90 days of unlinked incidents, split by service or CI. Score = size × priority weight × √(recurrence span in days) × (1 + reopen rate) × service criticality. Clusters already covered by an open problem are dropped. The LLM writes the label, a draft problem statement and a hypothesised cause citing incidents. Problem managers can question clusters in natural language; a person creates the problem.
- Build: clustering job; problem-candidate records owned by the problem module; naming skill.

**AI-046 · Change risk prediction** — پیش‌بینی ریسک تغییر
- P1 · AI: yes · Family: Predictive · Modules: change, release, devops
- Sources: ServiceNow (ML change risk and standard-template suggestions, Brazil; Change Success Score; risk assessment answers generator), ManageEngine (Zia Change Risk Prediction, top-2 levels), InvGate (risk and impact suggestions), BigPanda (Change Risk Management), BMC (Change Risk Advisor on AIOps health; Change Coordinator weighted Risk Level 1–5), Atlassian (Ops Expert risk with confidence; Prevention Center pre-risk assessment), Freshservice (AI-generated risk surveys; risk-aware rules), ITIL v5, standards (persist score, model version and top factors; a human authority decides).
- What/how: A calibrated probability of failure (failed, backed out or caused an incident within 7 days) from change type, lead time, window length, weekend or night, number and criticality of CIs, blast radius (downstream CIs within two hops weighted by service tier), CI and team failure rates (Beta-smoothed), collisions, blackout overlap, plan-quality score and pipeline signals. Mapped to Low/Medium/High by tenant thresholds with the top three factors; the LLM narrates only those factors. Questionnaire answers are pre-filled with reasoning; mitigations come from similar failed changes. Evidence is shown only if the viewer can read it; the AI never authorises a change.
- Build: per-tenant model (logistic regression or GBM with SHAP, isotonic calibration) retrained monthly; score, model version and factors stored on the change.

**AI-047 · Initiating-change detection** — کشف تغییر آغازگر حادثه
- P1 · AI: yes · Family: Predictive · Modules: incident, change, problem, event
- Sources: Freshservice (Find Initiating Changes: ranks changes closed in the last 14 days; one-click link), BigPanda (root-cause changes), BMC (Best Action Planner change tool), PagerDuty (Recent Changes).
- What/how: Ranks recent changes and deployments on the incident's CIs and their upstream dependencies by time proximity, topology and text similarity; one click records "caused by change", which also feeds change success metrics.
- Build: query over change windows and the CMDB graph; ranking skill.

**AI-048 · SLA breach prediction and escalation scoring** — پیش‌بینی نقض SLA و امتیاز تشدید
- P1 · AI: yes · Family: Predictive · Modules: slm, incident, request, workforce
- Sources: ManageEngine (Zia SLA Breach Prediction with confidence levels in an AI Insights panel and notifications, Nov 2026), ServiceNow (Escalation agentic workflow: Critical/High/Medium with a reason from SLA time left, urgency, priority and impact), JSM (Request Router escalation from sentiment and SLA), ITIL (time-to-breach prediction), standards (SLE breach prediction), ai.md (survival model; few vendors ship a per-ticket probability).
- What/how: For every running SLA, the probability of breach comes from a survival model (elapsed business time, pause time, category, service, CI tier, group backlog and WIP, assignee load, reassignments, time since last customer reply, hour and weekday, Iranian holiday flag), recomputed every 5–15 minutes. Above a threshold the record gets an "at risk" badge, the group lead is notified and a skilled, available agent is suggested; an escalation label with a reason and the top drivers is shown.
- Build: survival model per SLA definition (Kaplan–Meier, then GBM AFT or Cox), isotonic calibration with a reliability diagram; scheduled job.

**AI-049 · Sentiment and emotion analysis** — تحلیل احساسات و هیجان
- P1 · AI: yes · Family: Predictive · Modules: incident, request, csm, esm, slm, portal
- Sources: ServiceNow (Positive/Neutral/Negative plus trend Improving/Declining/Stable with reasoning; scheduled job), Freshservice (sentiment with trend and explanation), JSM (customer sentiment), Zendesk (intelligent triage), ManageEngine (happy/neutral/sad per conversation), SysAid (AI Emotion), BMC (sentiment with trend and justification, BWF 26.1), monday service (tone detection).
- What/how: Scores each new public comment, e-mail or chat turn and keeps record-level sentiment and trend with an explanation. Feeds escalation, experience (XLA) dashboards and reply tone. Persian-specific handling: polite formulas can hide frustration. Only records with new public comments are processed.
- Build: small-tier classifier; per-comment scores; trend = slope over the last N comments.

**AI-050 · Smart assignment and skill-based routing** — تخصیص هوشمند و مسیریابی بر پایه مهارت
- P1 · AI: yes · Family: Predictive · Modules: workforce, incident, request, problem, change, release
- Sources: InvGate (Smart ticket assignment from past resolutions, workload, availability and outcomes; falls back to workload-based assignment; logged in history), Freshservice (precision routing; weekly ML skill inference over six months), ManageEngine (technician prediction, top-3), JSM (Rovo team routing from team descriptions; field and service routing), BMC (intelligent routing to the best support group), ServiceNow (PI assignment group; Advanced Work Assignment; AI routing-mode selector), TOPdesk (operator-group suggestion), HaloITSM, Xurrent.
- What/how: Score per eligible agent = skill match (ticket embedding vs the agent's resolved-work centroid) × success rate in the category × availability (shift, leave, Jalali holidays) × (1 − load ÷ limit), with a fairness rule (round-robin among the top k). Group routing can come from natural-language team descriptions. The choice is explained in history and falls back to the group queue below the confidence threshold. Inferred skills are confirmed by the person, and EU AI Act controls for work allocation apply (AI-180).
- Build: routing service; skill-inference job; "AI route" action in assignment rules.

**AI-051 · Expert and collaborator recommendation** — پیشنهاد خبره و همکار
- P1 · AI: yes · Family: Predictive · Modules: incident, problem, change, workforce, knowledge
- Sources: InvGate (Expert Collaboration across departments), ManageEngine (Collaborator Suggestion learned from sharing history, subject and description), BMC (Ops Swarmer recommended participants; Change Risk Advisor suggests experts such as a DBA reviewer), ServiceNow (consult on-call experts), JSM (Ops Expert related people; past responders).
- What/how: Suggests people to swarm with or consult, based on similar resolved work, CI ownership, on-call status and availability, with a reason; one click adds them as collaborator or watcher; restricted groups are respected.
- Build: retrieval over the people–record graph; on-call lookup.

**AI-052 · Volume forecasting and staffing** — پیش‌بینی حجم کار و نیروی موردنیاز
- P1 · AI: yes · Family: Predictive · Modules: workforce, analytics, portal
- Sources: ServiceNow (WFO Demand Forecast: STL at 15/30/60-minute intervals, manual adjustments, staffing formulas), Zendesk WFM (volume and subject-mix forecasts; required staffing; scenarios), JSM (30-day forecast with confidence band: predicted new work items, estimated required agents), standards (workload forecasting for staffing).
- What/how: Forecasts per queue and channel with the Jalali holiday calendar and regressors for planned changes and releases; major-incident outliers removed from training. Erlang C/A for chat and voice and a backlog model for tickets convert volume into staff; expected AI containment is subtracted. Back-test MAPE and bias are shown; managers adjust for known events.
- Build: forecasting jobs (STL or Holt-Winters); staffing calculator.

**AI-053 · Release risk and engineer prediction** — پیش‌بینی ریسک انتشار و مهندس مناسب
- P2 · AI: yes · Family: Predictive · Modules: release, devops
- Sources: ManageEngine (Zia release risk and release engineer predictions, May 2026), ITIL v5 (deployment-risk prediction), ai.md.
- What/how: Release risk = 1 − Π(1 − pᵢ) over the child changes plus release features (teams, services touched, freeze proximity). Engineers are ranked by an expertise vector against the release description, filtered by availability and load.
- Build: aggregation over AI-046; expertise vectors.

**AI-054 · Fulfilment-time prediction** — پیش‌بینی زمان انجام درخواست
- P2 · AI: yes · Family: Predictive · Modules: request, portal, slm
- Sources: ITIL (fulfilment-time prediction), standards (SLE breach prediction from WIP and age).
- What/how: Predicts the delivery date of a request item from historical cycle times, current queue and pending approvals, shows the requester an ETA range in the Jalali calendar, and updates it as the request moves.
- Build: quantile regression per catalog item; portal display.

**AI-055 · Next-action prediction and quick wins** — پیش‌بینی اقدام بعدی و کارهای سریع
- P2 · AI: yes · Family: Predictive · Modules: incident, request, workforce
- Sources: ServiceNow (next-action prediction: attach KB, link problem, update fields; Quick Wins; Analyze Task Trends), Freshservice (Copilot next-best actions).
- What/how: Suggests the next useful action on a record and marks quick-win tickets in queues so agents can clear them fast; actions run as proposals.
- Build: classifier over history; queue badge.

**AI-056 · Classic ML model lifecycle** — چرخه عمر مدل‌های یادگیری ماشین کلاسیک
- P1 · AI: yes · Family: Predictive · Modules: ai, admin (serves AI-041 – AI-055)
- Sources: ServiceNow (PI solution definitions: table, inputs, output, filter, word corpus, training frequency; Solution Statistics with precision and coverage per class over 30 days; per-class thresholds; Task Intelligence auto-train and auto-deploy when the new model wins), ManageEngine (models trained locally on each customer's data; ZiaVerifier role), Atlassian (per-customer models not shared).
- What/how: Define a solution (table, inputs, output field, filter, schedule) and train it per tenant only. A dashboard shows precision and coverage per class with daily values; thresholds are set per class; retraining is automatic and a new model is promoted only if it beats the deployed one on a holdout set. A verifier role reviews predictions.
- Build: `ml_model`; training jobs (Python/ONNX sidecar or in-database); metrics tables.

**AI-057 · Account health and churn prediction** — پیش‌بینی سلامت و ریزش حساب مشتری
- P2 · AI: yes · Family: Predictive · Modules: csm
- Sources: ITIL (account health, churn and renewal risk for CSM), Zendesk (CX analytics practice).
- What/how: Scores customer accounts from ticket trends, sentiment, SLA misses, escalations and renewal dates, with a narrative and next-best actions for the account manager.
- Build: scoring job; account dashboard.

#### 4. Conversational

**AI-058 · Employee AI assistant (virtual agent)** — دستیار هوشمند کارکنان
- P0 · AI: yes · Family: Conversational · Modules: portal, request, incident, knowledge, esm
- Sources: ServiceNow (Now Assist in Virtual Agent; Otto; EmployeeWorks; Moveworks assistant), JSM (virtual service agent; Rovo agent in the help centre), Freshservice (Freddy AI Agent: multi-turn, multilingual, formless, cited answers), Ivanti (persona-based self-service agent), InvGate (Virtual Service Agent with instant answers), Zendesk (AI agents), TOPdesk (Robin), SysAid (AI Chatbot), BMC (Employee Navigator with memory, voice and image input; Guest Portal Navigator), ManageEngine (Ask Zia with 65+ operations), Moveworks, Aisera, Atomicwork, Leena AI, Siit, Espressive, Serviceaide Luma, EasyVista (EV Pulse), Alemba, monday service; ITIL (virtual agent), standards (AI disclosure).
- What/how: A Persian-first assistant in the portal, Windows app and mobile web. It answers from permitted knowledge with citations, captures incidents and requests without forms, reports status, runs approved self-service actions and hands off to a person. Multi-turn with clarifying questions, attachments and images, in Persian or English; the AI disclosure is always visible; guest mode answers only from public content.
- Build: conversation core (`ai_conversation`, `ai_message`); router AI-059; channel adapters AI-064; tools from AI-075.

**AI-059 · Topics, intents and the answer router** — موضوعات، نیت‌ها و مسیریاب پاسخ
- P0 · AI: yes · Family: Conversational · Modules: portal, request, incident, esm
- Sources: JSM (VSA matches admin-built intents first and uses AI answers only when no intent matches), ServiceNow (VA topics; LLM topic discovery from topic descriptions; prompt library), Moveworks (reasoning engine selects plugins), ITIL (intent detection: incident, request, question, status), ai.md (router order).
- What/how: Every message is routed in order: (1) deterministic topics such as password reset, order status and known outages, which are fast and auditable; (2) action tools (catalog, status, access); (3) a grounded answer; (4) an offer to open a request or talk to a person. Intent classes include incident, request, question, status, complaint and department. The LLM picks topics from their descriptions; a suggested-prompt library guides users; the answering tier is logged for tuning.
- Build: topic designer (flow graph with slots); intent classifier; routing log.

**AI-060 · Conversational catalog ordering** — ثبت درخواست کاتالوگ با گفت‌وگو
- P0 · AI: yes · Family: Conversational · Modules: request, portal
- Sources: ServiceNow (conversational catalog: items marked conversational, supported variable types, question limit, "turn off Now Assist conversation for this item", overview dashboard), JSM (Create Request skill: guided collection of mandatory fields; link to a pre-filled form when fields are unsupported), Freshservice (bot-ready catalog items), Ivanti (Service Request Agent picks the template and submits), Moveworks, Aisera, Atomicwork, BMC (Employee Navigator submit, update, cancel), ManageEngine (Ask Zia), ITIL (slot filling).
- What/how: Catalog items become tools whose JSON schema is generated from their variables. Eligibility is computed (supported types, at most N questions, no blocking client scripts, not marked sensitive). Candidates are retrieved within the requester's catalog audience; the assistant disambiguates, asks one missing variable at a time, validates on the server as the requester (mandatory, patterns, reference qualifiers), shows a confirmation card and submits through the normal API so approvals, pricing and fulfilment run unchanged. Ineligible items get a deep link to the pre-filled form.
- Build: catalog-to-tool generator; slot-filling loop; server-side validation.

**AI-061 · Conversational incident capture** — ثبت حادثه با گفت‌وگو
- P0 · AI: yes · Family: Conversational · Modules: incident, portal
- Sources: Ivanti (Incident Agent: natural language → incident), ServiceNow (Create Incident AI agent), SysAid (chatbot creates service records), BMC (Smart Recorder formless entry), JSM (request raised from the conversation with its summary), Freshservice (ServiceBot pre-fills the ticket form from the conversation).
- What/how: From a free description and screenshots, the assistant first checks known issues and answers. If a ticket is still needed, it creates an incident with classified fields (AI-041), the affected CI picked from the user's assets and an urgency question, and attaches the conversation summary so the agent does not ask again.
- Build: `incident.create` tool with confirmation; classification; summary skill.

**AI-062 · Self-service status and actions in chat** — پیگیری وضعیت و اقدامات خودخدمت در گفت‌وگو
- P0 · AI: yes · Family: Conversational · Modules: portal, request, incident, change
- Sources: Ivanti (Q&A service: "my active incidents", status of an ID), ManageEngine (Ask Zia: request details, counts and summaries, pending approvals, add notes, notifications), BMC (Employee Navigator: requests, approvals, to-dos; update or cancel), Moveworks (approvals in chat), Freshservice (ticket status), ServiceNow (Approval Assistance in Virtual Agent).
- What/how: "Where is my laptop request?", "add a note", "cancel REQ-…", "approve my two pending approvals" — executed as the user with confirmation, and with step-up authentication for sensitive actions; answers link to the records.
- Build: record tools with the user's token; writes as proposals.

**AI-063 · Live-agent handoff with context** — انتقال به کارشناس انسانی با حفظ زمینه
- P0 · AI: yes · Family: Conversational · Modules: portal, workforce, csm
- Sources: Ivanti (configurable live-agent handoff), Moveworks (Live Agent improvements, Jan 2026), JSM (escalation to live chat; raise a request), ServiceNow (live agent in VA; voice handoff with transcript, summary and intent), ManageEngine ("Need Technician Assistance"), InvGate (handoff comment summarising what was already checked).
- What/how: Moves the conversation to a person (chat queue or ticket) with the transcript, an LLM summary (intent, steps tried, sentiment) and the collected fields. Routing uses the triage classifier. A human is always reachable, as the EU AI Act expects.
- Build: handoff tool; chat-queue integration; summary skill.

**AI-064 · Omnichannel adapters** — اتصال چندکاناله
- P1 · AI: yes · Family: Conversational · Modules: portal, integration, csm, esm
- Sources: Freshservice (portal, Slack, Teams ServiceBot, Email Bot, Microsoft 365 Copilot), InvGate (portal, Slack, Teams, WhatsApp, in-app), Zendesk (messaging, e-mail, voice), JSM (portal, help centre, Slack, Teams, e-mail, widget), Atomicwork (Slack, Teams, e-mail, browser; Claude and ChatGPT Enterprise via MCP), ServiceNow (Teams, Slack, web embeddables), ManageEngine (embeddable Ask Zia).
- What/how: One conversation core with renderers per channel: portal widget and Windows app (rich cards), e-mail (one reply holding all questions), Microsoft Teams (Adaptive Cards), Slack (Block Kit), WhatsApp, Iranian messengers (Bale, Eitaa, Telegram, Rubika), SMS gateways (short answers with links), an embeddable website widget, Microsoft 365 Copilot and any MCP client. Policies differ per channel (group chats stricter than private chats; restricted request types not offered where the audience cannot be evaluated). Identity is bound per channel by account linking with a one-time code.
- Build: channel-adapter interface; identity binding; per-channel rate limits.

**AI-065 · E-mail AI agent** — عامل هوشمند ایمیل
- P1 · AI: yes · Family: Conversational · Modules: incident, request, portal
- Sources: SysAid (AI Emailbot replies to e-mail-submitted records), Freshservice (Freddy AI Agent for Email: multi-reply conversations until resolution, Sept 2026), Zendesk (agentic e-mail AI agents, GA 2026-04-20), BMC (automatic e-mail responses with knowledge summary and a resolve option), ManageEngine (Auto Reply Solution).
- What/how: Answers e-mailed tickets with a grounded reply and asks for all missing details in one message, continuing the thread until resolution or handoff. Restricted topics are never answered; per policy an agent reviews before sending.
- Build: e-mail channel adapter; decision policy; thread state.

**AI-066 · Voice agents** — عامل‌های صوتی تلفنی
- P2 · AI: yes · Family: Conversational · Modules: portal, csm, incident
- Sources: ServiceNow (AI Voice Agents via CCaaS such as Genesys, 3CLogic, Twilio; caller authentication; transcript, summary and intent on escalation; case status and case creation agents), Zendesk (voice AI agents in 53 languages), BMC (voice input), ai.md (latency under ~800 ms to first audio; small model for turns).
- What/how: Phone self-service through a SIP/IVR connector (for example Asterisk/Issabel, common in Iran): streaming Persian speech-to-text → the same agent core → text-to-speech with barge-in. Identity is confirmed (callback, PIN or app push) before account actions; escalation passes the transcript and summary.
- Build: telephony adapter; streaming STT/TTS; small-model turn handling.

**AI-067 · Known-issue detection before submit ("add me as affected")** — تشخیص مشکل شناخته‌شده پیش از ثبت
- P0 · AI: yes · Family: Conversational · Modules: portal, incident, event
- Sources: ServiceNow (in-form deflection), ai.md (similarity over the requester's open incidents at ≥ 0.9 and open incidents on the same service; "add me as affected" on the parent), Ivanti (Teams bot deflection before ticketing), InvGate (similar requests at creation).
- What/how: Before a ticket is created, the description is matched against active major incidents, open problems with workarounds and the user's own open tickets. The user is offered "this looks like a known issue — add me as affected" (recorded on the parent) or "you already reported this".
- Build: retrieval over active incidents and outages; `affected_user` link.

**AI-068 · One front door across departments** — درگاه واحد برای همه واحدهای سازمان
- P1 · AI: yes · Family: Conversational · Modules: esm, portal, request, knowledge
- Sources: ServiceNow (Employee Center and EmployeeWorks across IT, HR, finance, facilities), Moveworks (AI Agent Marketplace for HR, finance, procurement), Atomicwork (AI Coworkers for IT, HR, finance), Ivanti (persona-based ITSM and ESM agents), standards (cross-department intent routing; HR-policy answers grounded only in the employee's country and entity articles; redaction of confidential cases before AI), ITIL ("which department owns this?").
- What/how: One assistant routes by intent to IT, HR, facilities, finance, legal and security using catalog and knowledge taxonomies; it answers only from the content audience the employee belongs to; sensitive departments use separate index partitions; handoffs carry only fields the receiving department may see.
- Build: department router; per-workspace sources and policies.

**AI-069 · Customer-facing AI agent** — عامل هوشمند ویژه مشتریان
- P2 · AI: yes · Family: Conversational · Modules: csm, portal
- Sources: Zendesk (AI agents across messaging, e-mail and voice; procedures; outcome-based resolution allowances), Atlassian (Customer Service Management AI agent; Support Companion), BMC (Customer Navigator), ServiceNow (CSM voice and triage agents), ai.md (account-scoped retrieval; entitlement-aware answers; brand voice).
- What/how: External customers get answers only from public articles and their own account's cases (`account_id ∈ user.accounts`, external visibility). Entitlements are checked before any response time is promised; brand voice and banned phrases are validated before sending.
- Build: external persona; entitlement tool; brand-voice classifier.

**AI-070 · Conversation memory and personalisation** — حافظه گفت‌وگو و شخصی‌سازی
- P2 · AI: yes · Family: Conversational · Modules: portal
- Sources: BMC (Employee Navigator personal context and memory: preferences, facts, prior interactions), Atlassian Rovo (memory management), InvGate (most-used categories), Moveworks (Content Activities).
- What/how: The assistant remembers preferences the user approved (language, device, location, delegate), recent topics and open items. Users can view and delete memories; secrets are never stored.
- Build: `ai_memory(user_id, key, value, source, expires_at)`; privacy controls.

**AI-071 · Agent copilot side panel** — دستیار جانبی کارشناس
- P0 · AI: yes · Family: Conversational · Modules: incident, request, problem, change, release, csm, esm, security, cmdb, itam, all record modules
- Sources: ServiceNow (Now Assist panel: record Q&A, summaries, similar records, charts, agentic workflows; Agent Assist recommended actions), Freshservice (Conversational Copilot "ask me anything" with citations; proactive insights; next-best actions), BMC (Ask HelixGPT; Service Collaborator; Agent Assist for problems and changes), JSM (Resolve with Rovo; Suggestions panel; Ops Expert chat), ManageEngine (Ask Zia; AI Insights panel), Atlassian Rovo Chat, Xurrent (Sera AI Assist), Atera (AI Copilot), Zendesk (Copilot auto assist).
- What/how: A panel on every record that knows its context: questions about the record ("what has the customer already tried?"), summary, similar records, suggested steps with citations, related knowledge, next-best actions as one-click proposals, charts from record data and launching an agent. Proactive mode shows insights without a prompt; voice input; follow-up questions keep context.
- Build: panel component; skills and tools scoped to the record; proposals.

**AI-072 · AI operator: natural-language app operations** — اپراتور هوشمند: انجام عملیات برنامه با زبان طبیعی
- P0 · AI: yes · Family: Conversational · Modules: all (platform)
- Sources: ManageEngine (Ask Zia performs 65+ operations through MCP tools scoped to the user's permissions; Zia Parser e-mail commands), ServiceNow (panel actions: create a change, propose a major incident or create a problem from an incident, June 2026), Freshservice (Copilot Agent actions with permission checks and per-action policies), JSM (one-click actions in the Suggestions panel; Rovo skills `/manage-queue`, `/manage-request-type`), BMC (Employee Navigator submit, update, cancel; IS RD Agent builds record definitions from conversation), Atlassian (Rovo agents in automation).
- What/how: Users ask, in Persian or English, for anything they can do in the UI: create, update, assign, transition, link, comment, approve, order, run or schedule a report, and (for admins) configure. It works from the panel, the Ctrl+K command bar, chat and messengers. The request becomes a plan of tool calls generated from the metadata engine (every record type's actions are typed tools). Reads run immediately; writes become proposals with a preview (diff and number of affected records) and confirmation; bulk operations show a sample first and can be undone. Nothing exceeds the user's permissions, and the audit trail says "done by user via AI".
- Build: tool registry generated from metadata (AI-075); planner; proposals executed through the normal mutation path; undo journal.

**AI-073 · Conversation analytics and deflection** — تحلیل گفت‌وگوها و سنجش حل خودکار
- P1 · AI: yes · Family: Conversational · Modules: portal, analytics, knowledge
- Sources: Freshservice (Freddy AI Agent overview report), ServiceNow (Conversational Catalog Overview; Now Assist Analytics; VA deflection tracking), InvGate (VSA report: deflection, volume, channel adoption, topics without knowledge coverage), JSM (virtual-agent reporting), ai.md (deflected = no ticket on the same topic within 72 hours).
- What/how: Containment, deflection, CSAT, escalation reasons, the router tier that answered, and the top unanswered intents (fed to the gap engine), per channel and language; a conversation review screen with redaction and permission checks.
- Build: conversation events; nightly deflection job; review UI.

#### 5. Agentic

**AI-074 · Agent definition model** — مدل تعریف عامل هوشمند
- P0 · AI: yes · Family: Agentic · Modules: all
- Sources: ServiceNow (AI Agents: role, instructions, tools, triggers, run-as dynamic user or AI user, role masking, supervised or autonomous; agentic workflows; `AiAgent` Fluent API for agents as code), Atlassian Rovo Studio (instructions, knowledge sources, sub-agents, tools and skills, model tier, conversation starters, triggers, sharing, verified agents), Freshservice AI Agent Studio (instructions, knowledge, agent workflows, ~30 integrations, custom functions, preset triggers), BMC HelixGPT Agent Builder, ManageEngine Zia Agent Studio (master agent with sub-agents; Agent Store), InvGate Agent Studio (per-department agents; per-action autonomy), SysAid AI Agent Builder (100+ prebuilt agents), HaloITSM (AI Agent runbook steps under an Application identity), Xurrent Agent Designer, Aisera, Rezolve.ai Creator Studio, Zammad (background AI agents triggerable by macros).
- What/how: An agent record holds name, role and goal; instructions (a natural-language procedure that may reference KB-047 procedures); knowledge scope (bases, collections, sources); tools and sub-agents; triggers (record conditions, events, schedules, channel invocation, assignment to the agent's user); identity (run as caller or as an AI user) and role mask; autonomy (shadow, supervised, autonomous, per request type); budgets (steps, tokens, wall time, monthly cost); conversation starters; owner, version, 6C tags and risk tier. Agents export and import as code.
- Build: versioned `ai_agent`; studio UI; link to the AI system register (AI-175).

**AI-075 · Tool registry with risk classes and per-action policies** — رجیستری ابزارها با رده ریسک و سیاست هر اقدام
- P0 · AI: yes · Family: Agentic · Modules: all
- Sources: Freshservice (Copilot Agent actions: Always allowed / Approval required / Blocked; allowed groups; new actions arrive unmapped), InvGate (auto / confirm / never per action), ServiceNow (downstream ACL conjunction: the invoker must pass the ACL of every tool on the agent), access.md (tools are ordinary API operations with required permission, risk and policy; unmapped tools blocked), ai.md (risk classes and argument validation), HaloITSM (agent functions identical to its MCP server).
- What/how: Every tool is a typed operation with a JSON schema: generated from the metadata engine for record actions, or registered for flows, catalog items, connectors, MCP servers and HTTP calls. Each has a required permission, risk class (read, write-low, write-high, destructive, external-send), policy (auto, confirm, approval, blocked), allowed groups and argument validators. New or unmapped tools are blocked by default. An agent runs only if its identity passes the permission of every tool it holds (fail closed).
- Build: `ai_tool`; generator from metadata; validators; policy evaluation at call time.

**AI-076 · Agent runtime: plan, cite, approve, execute** — اجرای عامل: برنامه، ارجاع، تأیید و اجرا
- P0 · AI: yes · Family: Agentic · Modules: all
- Sources: Atlassian Request Resolver (cited step-by-step resolution plan, editable in chat; native actions; pauses on low-confidence or irreversible steps; Stop/Resume; status field and queue; resumes after requester replies or approvals), ServiceNow (agents show their recommendation before updating; orchestrator step log), BMC (Ticket Resolver confidence and risk decisioning hands low-confidence actions to humans; full activity trail), PagerDuty (approval before remediation), ai.md (persisted steps, budgets, kill switch).
- What/how: A run turns the goal into cited steps and shows the plan, which people can edit. Reads execute; writes become proposals according to policy; the run waits for approvals or requester input and resumes on the event; tool calls are idempotent; budgets are enforced; each step records inputs, tool, result and approver. Irreversible and external actions always pause for a person. Runs can be stopped and resumed and survive restarts.
- Build: `ai_run`, `ai_tool_call`, `ai_proposal`; job handler advances one step per tick; approvals are normal approval records.

**AI-077 · Shadow → supervised → autonomous progression** — مسیر تدریجی از حالت سایه تا خودمختار
- P1 · AI: yes · Family: Agentic · Modules: request, incident, event (all agents)
- Sources: Atlassian (Supervised and Autonomous modes per request type; promote only after consistently good supervised results; never autonomous for onboarding or legally significant decisions), PagerDuty (approval by default unless a team opts out), TOPdesk ("TOPdesk suggests, your operator decides"), InvGate (autonomy widened gradually), ai.md (promote at ≥95% plan acceptance over the last 50 plans with no safety incident; demote automatically when reopen rate crosses a threshold).
- What/how: New agents start in shadow mode (proposals logged but not shown), move to supervised (people approve plans), and become autonomous per request type or category once acceptance, 7-day reopen rate and CSAT meet thresholds. Quality drops trigger automatic demotion; excluded categories (legal or HR decisions) can never become autonomous.
- Build: metrics per agent and scope; promotion workflow with approval.

**AI-078 · Multi-agent orchestrator and visible agent progress** — هماهنگ‌ساز چندعاملی و نمایش پیشرفت عامل
- P1 · AI: yes · Family: Agentic · Modules: all
- Sources: ServiceNow (AI Agent Orchestrator: plans, picks agents and tools, passes context, asks humans, logs each step; plan shown inside workspaces since March 2026 with real-time course-correction; Agentic processes tab), ManageEngine (Zia master agent with sub-agents), Ivanti (multi-agent self-service), JSM (ICC investigations), Atlassian Rovo (sub-agents).
- What/how: A planner splits a goal into steps across specialist agents and tools, keeps shared context, asks people at checkpoints and shows progress on the record in an "Agent activity" tab where users can correct course; parallel steps are capped.
- Build: orchestrator agent type; step graph in `ai_run`; record tab component.

**AI-079 · LLM steps in workflows and automation** — گام‌های هوش مصنوعی در گردش‌کار و قوانین خودکار
- P0 · AI: yes · Family: Agentic · Modules: platform (flows), all
- Sources: ServiceNow (LLM actions in Flow Designer and scripts through the Generative AI Controller; agents callable from flows), HaloITSM (AI Ability step mapping variables to JSON outputs; AI Agent step in runbooks), JSM (Automation "Use Rovo agent" action with `{{agentResponse}}`; agent triggers; admins can stop agents acting in automations), Freshservice (agent workflows), Zammad (AI agents run by macros), Aisera (AI Workflow Builder).
- What/how: Workflow nodes for classify, extract (to a JSON schema), summarise, translate, generate text, decide (with confidence and reason) and call an agent; outputs map to variables; low-confidence branches route to people; admins can forbid AI write actions inside automations.
- Build: workflow-engine node types that call the gateway; schema-validated outputs.

**AI-080 · Triage agent** — عامل تریاژ
- P1 · AI: yes · Family: Agentic · Modules: incident, request, csm, security
- Sources: ServiceNow ("Triage and categorize ITSM incidents": category, service, offering, CI, link major incident or known problem; "Not determined" when unclear; recommendation with reasons before update; Triage cases agents for CSM), JSM (Request Router automation mode; bulk Triage), Xurrent (Triage agent), BMC (Ticket Resolver triage including VIP priority), Zammad (background categorisation, priority and title edits with visible presence), monday service (Intake & Triage Agent).
- What/how: On creation it sets fields (through AI-041), picks the CI from the caller's assets, links matching known errors, major incidents or problems, improves the title and records its reasoning. In supervised mode it presents the recommendation first; it never asks the user and abstains when unsure.
- Build: agent with classification and linking tools; create-event trigger.

**AI-081 · Investigate-and-resolve agent** — عامل بررسی و حل
- P1 · AI: yes · Family: Agentic · Modules: incident, request, problem
- Sources: ServiceNow ("Investigate and resolve ITSM incidents": top related catalog items, KB and similar incidents, resolution steps to work notes; triggered at In progress with Run as = Assigned to; Incident Analyzer auto-investigates new P1/P2; Wrap-up and resolve: notes, known-error articles, closure), BMC (Ticket Resolver; Service Collaborator), JSM (Resolve with Rovo; Ops Expert "find cause"), Xurrent (Sera Investigate; Closure agent), Freshservice (Resolution insights).
- What/how: Runs as the assignee: gathers evidence (similar incidents, knowledge, known errors, CMDB, recent changes, monitoring through tools) and writes a cited investigation and resolution plan to work notes; starts automatically for P1/P2; at the end drafts resolution notes, attaches known-error articles and proposes closure after the requester confirms.
- Build: agent with retrieval and diagnostic tools; AI-flagged work notes.

**AI-082 · Autonomous L1 resolver ("AI specialist")** — حل‌کننده خودمختار سطح یک
- P1 · AI: yes · Family: Agentic · Modules: incident, request, portal, esm
- Sources: ServiceNow (L1 Service Desk AI Specialist; Autonomous Workforce under an AI-user identity), BMC (Ticket Resolver 26.2–26.3 auto-executes eligible steps through Intelligent Automation), Atlassian (Request Resolver autonomous mode), ManageEngine (L1 ServiceDesk Specialist agent), Xurrent (autonomous triage, knowledge and closure agents), Atera (IT Autopilot; Robin on-device), Moveworks, Aisera, Atomicwork (AI Coworkers with budgets), Zendesk (AI agents with procedures), SysAid, HaloITSM (runbook agents).
- What/how: An AI-user principal handles eligible tickets end to end (password or MFA reset, access, software installation, mailbox changes, FAQs) by following procedures (KB-047): it asks for missing information, requests approvals, runs tools, verifies with the requester and closes with "closed by AI" attribution. It escalates when confidence, policy or approvals require. Its capacity is counted separately in workforce planning.
- Build: autonomous agent with an AI-user identity; allowed request types; attribution fields.

**AI-083 · Fulfilment action library** — کتابخانه اقدامات اجرایی
- P1 · AI: yes · Family: Agentic · Modules: request, itam, access, integration
- Sources: Moveworks (password reset, access and group provisioning, software requests across 100+ systems), Aisera (1,000+ actions), Atomicwork (100+ skills), ServiceNow (Integration Hub spokes; Microsoft 365 licence assignment), Freshservice (Copilot actions such as password reset through integrated apps; ~30 integrations), Zendesk (Advanced Action Flows with Okta, Entra ID, Jamf, Intune), Siit (password resets and access grants in the thread).
- What/how: Prebuilt, policy-gated actions: password and MFA reset, account unlock and group membership in Active Directory, LDAP, FreeIPA, Entra ID or Okta; mailbox and distribution-list changes (Exchange, Zimbra); licence assignment; software deployment through endpoint management; VPN profiles; device lookup; order status. Each has a dry run, an approval requirement and an audit entry.
- Build: connector actions registered as tools (AI-075); secrets in the vault; external-lane jobs.

**AI-084 · Follow-up agent** — عامل پیگیری
- P1 · AI: yes · Family: Agentic · Modules: incident, request, csm
- Sources: BMC (automatic reminders for incidents waiting on the customer; follow-ups stay active until relevant information arrives; acknowledgement screening), Atlassian Request Resolver (asks the requester for missing information and resumes), JSM (contextual "Follow up" pill), ManageEngine.
- What/how: When a ticket waits on the requester, the agent sends polite reminders in the user's channel on a schedule, tells real information apart from acknowledgements, resumes the work, and proposes closure after N reminders per policy, counting Iranian working days.
- Build: agent bound to the "waiting for customer" state; schedules on the Jalali business calendar.

**AI-085 · Problem investigation agent** — عامل بررسی مسئله
- P1 · AI: yes · Family: Agentic · Modules: problem, incident, change
- Sources: ServiceNow (Investigate problems agent; Link incident to problem agent), BMC (Problem Coordinator 5 Whys; Agent Assist for problem investigations), JSM (Ops Expert "suggest problem ticket" and cause from history), ManageEngine (RCA by Zia).
- What/how: Reads the problem, linked and similar incidents, changes, CIs and monitoring evidence; proposes root causes with evidence, impact and a fix plan; proposes links from matching incidents to the problem; drafts the known-error article (KB-046).
- Build: agent with retrieval, graph and change tools.

**AI-086 · Change agents** — عامل‌های مدیریت تغییر
- P1 · AI: yes · Family: Agentic · Modules: change, release
- Sources: BMC (Change Coordinator: validates readiness and documentation, weighted Risk Level 1–5, posts activity notes; Change Approval Assistant / CAB Supervisor: readiness summary, evidence, gaps, conflicts, recommendation, Q&A; never updates records), ServiceNow (Change AI Specialist guided creation; Assess conflicts; Schedule a change; Change outage assistant; Change Quality Assessor; Suggest configuration items), JSM (Prevention Center), Freshservice (Similar Change Suggester).
- What/how: The coordinator validates a change when it reaches a status (completeness, plans, CI scope, window) and scores readiness and risk. The CAB assistant summarises readiness for approvers and answers their questions. The scheduling agent proposes a conflict-free window outside blackouts and Iranian holidays. Guided creation asks only for missing information and proposes affected CIs; outage records are drafted. Approval always stays human.
- Build: agents bound to change states; conflict and calendar tools.

**AI-087 · Approval assistance agent** — عامل کمک به تأییدکننده
- P1 · AI: yes · Family: Agentic · Modules: request, change, platform, financial
- Sources: ServiceNow (Approval Assistance agent: gathers request details, checks policy, recommends approve or reject; Intelligent Approvals in Brazil), BMC (CAB Supervisor recommends, people decide), standards (approval recommendations with rationale; the human approver decides), ManageEngine (e-mail approval replies interpreted by AI).
- What/how: Each pending approval shows a summary, policy checks (budget, entitlement, separation of duties, duplicates, risk) and a recommendation with reasons; the approver decides; low-risk items can be approved in bulk after confirmation.
- Build: agent attached to approval records; policy tools.

**AI-088 · Journey agent (onboarding and offboarding)** — عامل سفر کارکنان (ورود و خروج)
- P2 · AI: yes · Family: Agentic · Modules: esm, request, access, itam
- Sources: ServiceNow (journey agents; onboarding ramp-up plan; interview scheduling), Atlassian Request Resolver (employee onboarding journey types), Zendesk (onboarding through Advanced Action Flows), Leena AI (proactive lifecycle nudges), ai.md (every journey task maps to a real catalog item).
- What/how: Proposes a personalised onboarding or offboarding plan from the journey template plus role, location and manager inputs; every task maps to a real catalog item or activity; progress is tracked and owners are nudged.
- Build: journey templates; agent proposals; catalog tools.

**AI-089 · Access-request agent** — عامل درخواست دسترسی
- P2 · AI: yes · Family: Agentic · Modules: access, request
- Sources: access.md (recommended: collects role and access requests, routes them through the authority matrix with SoD checks, provisions through SCIM or IGA after approval), Moveworks (access and group provisioning in chat), Siit.
- What/how: Understands requests like "I need the same finance share access as Ali", maps them to roles and groups, checks separation of duties and policy, routes approvals, provisions after approval and explains each decision.
- Build: agent with identity-management tools; SoD engine.

**AI-090 · Asset and procurement agents** — عامل‌های دارایی و تدارکات
- P2 · AI: yes · Family: Agentic · Modules: itam, financial, request
- Sources: ServiceNow (software sourcing agent: allocate an existing licence or raise a purchase order; Microsoft 365 License Assignment agent; hardware request workflow with sourcing, transfer order, purchase order and repair agents; Evaluate Software Reclamation), JSM (Rovo hardware skills).
- What/how: For a software or hardware request, checks stock and the licence pool, proposes allocation or purchase, prepares transfer or purchase orders for approval and handles repairs.
- Build: agent with ITAM tools.

**AI-091 · Security operations agents** — عامل‌های عملیات امنیت
- P2 · AI: yes · Family: Agentic · Modules: security, incident
- Sources: ServiceNow (Observable analysis agent for IOC verdicts; EDR agent; Exchange Online agent; Security Incident Resolver v2 with AI Runbooks; Shift Handover and Wrap Up workflows; recommended actions), BMC (Vulnerability Classification agent), ai.md (containment always needs approval and is logged immutably).
- What/how: Enriches observables (hash, IP and domain reputation, EDR process tree) and returns a verdict (malicious, suspicious, benign, unknown) with evidence; drafts response steps, shift handover briefs and close-out notes. Containment (isolate host, disable account, purge mail) always requires human approval.
- Build: agents in the security partition; threat-intelligence tools.

**AI-092 · Project and demand agents** — عامل‌های پروژه و تقاضا
- P2 · AI: yes · Family: Agentic · Modules: project, service_portfolio
- Sources: ServiceNow (Monitor Project Tasks; Identify Project Risks as AI drafts; Demand Management Automation validating demands and converting them into work), Atlassian Rovo (Work item Planner, Progress Tracker).
- What/how: Watches project tasks for slippage and blockers, proposes risks as drafts, validates new demands for completeness and duplicates, and proposes converting them into projects or changes.
- Build: agents with project tools.

**AI-093 · Remediation runbook agent** — عامل اجرای دستورالعمل اصلاحی
- P2 · AI: yes · Family: Agentic · Modules: event, incident, continuity
- Sources: ServiceNow (Remediation Agent finds and runs the matching remediation subflow; Remedial Action Framework), PagerDuty (Paige: remediation waits for approval unless the team opts out), BMC (Automation Advisor; Best Action Recommendation with a remediation-script wizard), Datadog (Bits remediation), ai.md (runbook registry with preconditions, blast radius, approval policy, dry run and post-check).
- What/how: Matches an incident or alert to a registered runbook (preconditions, target CI class, blast radius), performs a dry run, asks for approval (unless the team exempted a low-risk runbook), executes through automation connectors, verifies with a post-check and records "remediated by AI".
- Build: runbook registry; automation connectors (Ansible, PowerShell, SSH through an on-site relay agent).

**AI-094 · Web, desktop and RPA agents** — عامل‌های وب، دسکتاپ و RPA
- P2 · AI: yes · Family: Agentic · Modules: integration, request, itam
- Sources: ServiceNow (AI web agent for UIs without APIs; AI Desktop Actions; Project Arc sandboxed desktop agent governed by AI Control Tower; RPA Hub; Task Mining), Atera (Robin on-device agent).
- What/how: For legacy systems without APIs, a sandboxed browser or desktop agent performs scripted UI steps under strict policy, with recordings and approvals. An optional on-device agent in the Windows app runs approved fixes on the user's own PC (clear caches, reset network settings) with consent.
- Build: sandboxed automation runner; Windows-app agent with signed actions.

**AI-095 · MCP server (headless service management)** — سرور MCP (مدیریت خدمات بدون رابط کاربری)
- P1 · AI: yes · Family: Agentic · Modules: integration, ai, all
- Sources: ServiceNow (Action Fabric / MCP Server Console: skills, Knowledge Graph, subflows and scripted REST as MCP tools; OAuth; data-layer ACLs; Integrate, Govern and Observe views), Xurrent (open MCP server; external agents inherit the shared policy and data layer and the same audit), TOPdesk (read-only MCP scoped to the customer's data), InvGate (nine read-only tools; per-user revocable tokens inheriting the user's permissions; ready configs for Claude Desktop/CLI, Cursor, VS Code, Gemini CLI, Codex CLI), Freshservice (MCP Gateway), ManageEngine (Zoho MCP; Zia Agents on MCP), Atlassian (Rovo MCP server under user permissions; blockable by data security policy), HaloITSM (MCP tool collections), Atomicwork (headless ITSM via MCP); MCP authorization specification (OAuth 2.1, audience-bound tokens, no token passthrough).
- What/how: Exposes curated tools (search knowledge, get and list records, create a draft ticket, add a comment, summarise, run approved skills) to external AI clients over MCP, with OAuth 2.1 and per-user revocable tokens that inherit the user's permissions. Read-only by default; write tools are opt-in per tenant and produce proposals. AI-channel policy and kill switches apply per client and tool; usage and errors are measured.
- Build: MCP endpoint; `mcp_token`; same authorization layer; audit.

**AI-096 · MCP client and external tool registry** — کلاینت MCP و رجیستری ابزارهای بیرونی
- P1 · AI: yes · Family: Agentic · Modules: integration, ai
- Sources: ServiceNow (AI Agent Studio MCP client and Universal MCP client; AI Gateway lifecycle In Review → Assess → Approved → Active → Deprecated with AI Steward approval; OAuth 2.1; sensitive-data blocking; instant pause; per-tool metrics), Atlassian (third-party MCP agents; New Relic MCP tools for Ops Expert), Freshservice.
- What/how: Admins register external MCP servers (monitoring, identity, cloud, documentation) through an approval lifecycle; only approved tools can be attached to agents; each imported tool gets a risk class and policy; traffic passes the gateway (personal-data blocking, logging, pause).
- Build: `mcp_server` registry; tool import into AI-075; steward approvals.

**AI-097 · Agent-to-agent (A2A) interoperability** — تعامل عامل‌به‌عامل
- P2 · AI: yes · Family: Agentic · Modules: integration, ai
- Sources: ServiceNow (A2A client and server: agent cards; task states submitted, working, completed, failed, cancelled; message parts; SSE streaming; push notifications; OAuth 2.0 or API keys; SRE agent over A2A), HaloITSM (Agent Interoperability: "connect any external agent, control every permission").
- What/how: Our agents can call external specialist agents and can be called as specialists by other platforms, with agent cards, task lifecycle and streaming; every inbound call runs as a mapped principal with its own grants.
- Build: A2A endpoints; principal mapping; governance in the control centre.

#### 6. AIOps

**AI-098 · Alert correlation and grouping** — همبسته‌سازی و گروه‌بندی هشدارها
- P1 · AI: yes · Family: AIOps · Modules: event, incident
- Sources: ServiceNow (automated ML alert groups; AI analysis for alert groups; proactive grouping recommendations every 5 minutes; Text-to-Configuration agent), JSM (Rovo alert grouping in a rolling 24-hour window; group → incident with AI-written details), PagerDuty (Intelligent, Content-Based, Time-Based and Global Alert Grouping), BigPanda (correlation patterns over the IT Knowledge Graph), Splunk ITSI (episodes; Event iQ), BMC (ML-based situations by temporal, topological and knowledge-graph similarity with top-3 causal nodes), Freshservice (Freddy ML attaches alerts to open incidents; manual links retrain it), Xurrent (AI alert correlation), standards.
- What/how: Pipeline: normalise → fingerprint de-duplication → enrichment (CI, service, owner group, recent changes) → noise → correlation → incident create or update. The correlation score combines same CI or service within the window, topology distance, learned co-occurrence of alert types, similarity of templated messages and priors from human merges and splits. Groups are durable (rolling 24 hours); people can split or merge them, which becomes training data. Grouping rules can be written in plain language and simulated before activation.
- Build: event-pipeline jobs; `alert_group`; feedback table.

**AI-099 · Noise classification and auto-pause** — شناسایی نویز و توقف خودکار اعلان
- P1 · AI: yes · Family: AIOps · Modules: event
- Sources: ServiceNow (LLM noise classification: noise vs requires operator action; noise closed by the AIOps specialist), PagerDuty (Auto-Pause Incident Notifications for transient alerts with a suggested pause length; alerts resolved by hand are never treated as transient), JSM (signal vs noise learned per tenant).
- What/how: Features: flap count, auto-clear rate, median time to auto-clear, historical acted-upon rate, hour of week. A GBM or logistic model scores known alert types and an LLM classifies new ones. Suggested auto-pause = P90 time-to-auto-clear for that service. Alerts on tier-1 services are never auto-closed without a second signal.
- Build: per-tenant noise model; notification suppression policy.

**AI-100 · Alert and situation explanation** — توضیح هشدار و موقعیت
- P1 · AI: yes · Family: AIOps · Modules: event, incident
- Sources: ServiceNow (Alert Assist; AI Insights card on the alert form; auto-closure reasoning), BMC (Situation Analyzer; Ask HelixGPT predefined questions on impact, owning team, related changes, recurrence, 5 Whys), JSM (alert-detail AI: similar alerts, past responders, related resources; incidents created from alerts with AI details).
- What/how: Explains in plain language what an alert or group means, the probable cause and next steps, answers standard questions, and writes the incident title and description when an alert group is promoted.
- Build: skill over alert context and history.

**AI-101 · Probable root-cause ranking** — رتبه‌بندی علت ریشه‌ای محتمل
- P1 · AI: yes · Family: AIOps · Modules: event, incident, problem
- Sources: ServiceNow (AIOps AI Specialist investigates probable cause with CMDB and topology), BMC (Root Cause Finder; Best Action Planner with change, log and code tools; Deep RCA; root-cause isolation with a score per causal event), PagerDuty (Probable Origin, Past and Related Incidents, Recent Changes, Outlier Incident), BigPanda (root-cause changes; AI Incident Assistant), Dynatrace (deterministic causal AI over live topology), Datadog (Bits Investigation with Agent Trace and `bits.md` team guidance), Xurrent (AI SRE teammate), JSM (ICC hypotheses with High/Medium/Low confidence and evidence), ITIL v5, standards.
- What/how: Deterministic candidates come first: alerts in the group, changes and deployments on affected CIs and their upstream dependencies in the last 24 hours, log-template spikes and configuration drift, scored by temporal precedence, upstream position, change proximity and historical co-occurrence. The LLM receives the top five with evidence and returns hypothesis, evidence references, confidence and next checks; with thin evidence it says so. Teams can attach troubleshooting guidance per service.
- Build: RCA service; graph traversal; JSON-output skill.

**AI-102 · Service-graph impact analysis** — تحلیل اثر بر خدمات در گراف وابستگی
- P1 · AI: yes · Family: AIOps · Modules: event, incident, change, cmdb, continuity
- Sources: ServiceNow (Analyze Alert Impact over service maps; impact step of the AIOps specialist), BMC (advanced impact analysis: affected CIs and services from CMDB relationships, HelixGPT summary and recommended actions, 26.3; upstream/downstream impact hierarchy), ITIL (impact prediction).
- What/how: From an alert, incident or change, walks dependencies to list impacted services, users and business processes with criticality and redundancy, summarises the business impact and links impacted CIs in one step.
- Build: graph traversal; impact-summary skill.

**AI-103 · Incident command centre (war-room AI)** — اتاق فرمان حادثه با هوش مصنوعی
- P1 · AI: yes · Family: AIOps · Modules: incident, event, continuity
- Sources: JSM (Incident Command Center: AI overview across comments, alerts and chat; hypotheses with confidence and evidence; telemetry; mitigation plans; communication drafts; compiled PIR), BMC (Ops Swarmer timelines and summaries in Teams), PagerDuty (Scribe, Shift and Insights agents), Atlassian Ops Expert, analytics_ux (a self-contained war room with roles, update-cadence timer, auto timeline and AI PIR that works without Slack or Teams and with local messengers).
- What/how: A major-incident workspace with a live AI overview, a timeline captured automatically from every channel, hypotheses with confidence and evidence, suggested mitigations, roles (commander, communications, scribe), an update-cadence timer with AI-drafted updates and a one-click PIR draft. In-app chat and local messenger groups feed it.
- Build: major-incident workspace; timeline capture; skills AI-024, AI-029, AI-030, AI-101.

**AI-104 · Anomaly detection and adaptive thresholds** — کشف ناهنجاری و آستانه‌های تطبیقی
- P2 · AI: yes · Family: AIOps · Modules: event, continuity, financial, analytics
- Sources: Splunk ITSI (adaptive per-entity thresholds; ML threshold recommendations; service health scores), Datadog (Watchdog), Dynatrace (auto-adaptive baselines), ServiceNow (Metric Intelligence dynamic thresholds; Health Log Analytics), BMC (anomaly events; Adaptive Data Collector; Log Insights), ITIL (dynamic baselines), standards (seasonal baselines).
- What/how: Seasonal series use STL decomposition with a robust z-score; Holt-Winters gives forecast intervals; per-entity hour-of-week quantile thresholds scale to thousands of entities; CUSUM or Bayesian change-point detection finds shifts; log templates (Drain) get a Poisson spike test. Anomalies become explained alerts.
- Build: metric ingestion (or from monitoring tools such as Zabbix and Prometheus); anomaly jobs.

**AI-105 · Capacity forecasting and time to exhaustion** — پیش‌بینی ظرفیت و زمان اتمام منابع
- P2 · AI: yes · Family: AIOps · Modules: continuity, event, itam
- Sources: Splunk ITSI, Dynatrace, BMC (Helix Continuous Optimization: forecasts tied to business drivers, what-if simulations, rightsizing), ManageEngine (OpManager forecast reports), ServiceNow (Metric Intelligence), ITIL v5 (predictive capacity), standards (capacity forecasting).
- What/how: Holt-Winters or robust regression per metric (disk, CPU, memory, licences, queue depth). Time to exhaustion is the first point where the upper 80% interval crosses capacity; a capacity risk is raised when that is shorter than the procurement lead time. Monthly back-tests track MAPE; what-if scenarios are supported.
- Build: forecasting jobs; capacity-risk records.

**AI-106 · Outage prediction and continuity watchlist** — پیش‌بینی قطعی و فهرست پایش تداوم کسب‌وکار
- P2 · AI: yes · Family: AIOps · Modules: continuity, event, slm
- Sources: BMC (service predictions: services likely to degrade within 12 hours; Service Health Insight), Splunk ITSI (predictive health scores), ai.md (availability risk score and weekly LLM watchlist).
- What/how: Availability risk per service from the recent incident rate, open problems without workarounds, risky changes planned in the next seven days, single points of failure in the CMDB and capacity risks, plus a weekly continuity watchlist narrative and predicted-degradation alerts.
- Build: scoring job; watchlist report.

**AI-107 · Autonomous alert handling ("closed by AI")** — رسیدگی خودمختار به هشدارها
- P2 · AI: yes · Family: AIOps · Modules: event
- Sources: ServiceNow (Manage alerts autonomously; AIOps AI Specialist; Alert Verification agent closes alerts using incidents and KB; "Closed by AI" attribution; alerts returned to the original operator; reopened alerts get a full investigation), PagerDuty (Paige SRE agent), BMC (Automation Advisor), Datadog (Bits).
- What/how: An AIOps agent works the alerts in its scope: enriches, groups, verifies recovery and closes noise or recovered alerts with attribution, then hands back to the original owner. Reopened alerts are always fully investigated, and the agent never overrides human ownership.
- Build: AI-user agent; attribution fields.

**AI-108 · Observability analysis agents** — عامل‌های تحلیل داده‌های پایش
- P2 · AI: yes · Family: AIOps · Modules: event, integration
- Sources: ServiceNow (Datadog and Google Cloud Observability analysis agents; ITOM MCP Server), JSM (New Relic MCP tools for Ops Expert: logs, error rates, deployments), BMC (Log Insights), Datadog.
- What/how: During an investigation, agents query monitoring tools (Zabbix, Prometheus/Grafana, Elastic, Datadog, New Relic) through connectors or MCP for logs, metrics and deployments and attach findings with links.
- Build: connector or MCP tools; investigation agent.

**AI-109 · Reliability and SLO gap agent** — عامل کشف شکاف‌های پایایی و SLO
- P2 · AI: yes · Family: AIOps · Modules: continuity, problem, slm
- Sources: ServiceNow (Reliability Domain Agent finds SLO and synthetic-monitoring gaps from post-incident data and opens reliability tasks).
- What/how: After major incidents, checks whether the affected service had SLOs, synthetic checks and alerts that would have caught the issue earlier, and proposes reliability tasks.
- Build: agent with SLO and monitoring inventory tools.

**AI-110 · On-call intelligence** — هوشمندی برنامه آماده‌به‌کار
- P2 · AI: yes · Family: AIOps · Modules: workforce, event
- Sources: PagerDuty (Shift agent: schedule conflicts and coverage; Insights agent), ServiceNow (Teams on-call agent: who is on call, coverage and leave requests), Xurrent (IMR AI scheduling weighing time zones, workload and leave; natural-language rotations).
- What/how: Answers "who is on call for X?", detects coverage gaps and conflicts (leave, Iranian holidays) and proposes fair rotations from rules written in plain language.
- Build: on-call schedule tools; skill.

#### 7. Analytics and natural-language reporting

**AI-111 · Natural language → governed query** — پرسش با زبان طبیعی و تبدیل به پرس‌وجوی کنترل‌شده
- P0 · AI: yes · Family: Analytics · Modules: analytics, all
- Sources: ServiceNow (data visualization generation; AI Data Explorer; schema-aware data Q&A, read-only), BMC (Insight Finder; agentic aggregation queries such as "how many P1 incidents for service X last week"), JSM (Rovo in Insights: natural-language questions answered by SQL-backed results; AI SQL; AI formulas), Freshservice (Ask Freddy widgets; Conversational Insights), ManageEngine (Ask Zia; Analytics Charts in Ask Zia), HaloITSM (Report AI assistant), standards (questions compile to governed queries over permitted data), analytics_ux (ACL-true AI analyst; never raw SQL).
- What/how: A question becomes {metrics, dimensions, filters, time range (Jalali-aware), grain, chart hint} over a semantic layer of certified metrics. The server compiles SQL under the caller's row-level security with small-cell suppression; the interpretation is shown as editable chips; the model never writes raw SQL against the database. An admin mode allows AI-written calculated metrics in a sandbox.
- Build: semantic metric layer; question-to-AST skill; compiler; `nl_query_log`.

**AI-112 · Natural language → charts and dashboards** — ساخت نمودار و داشبورد با زبان طبیعی
- P0 · AI: yes · Family: Analytics · Modules: analytics, all dashboards
- Sources: ServiceNow (generated visualisations added to dashboards; conversational export to PDF and PowerPoint), BMC (Insight Finder builds dashboards and panels; multilingual PDF export), JSM (Rovo chart creation), Freshservice (Ask Freddy widgets), ManageEngine (Ask Zia charts).
- What/how: Chart types are chosen by rules first (single value → score, time series → line, ≤7 categories → bar, share → stacked bar), and the LLM chooses only among valid options. The result is saved as a report definition (not a data snapshot) that can be added to dashboards, scheduled or alerted on; RTL charts with Persian digits; export to PDF and PowerPoint.
- Build: report definitions; chart renderer; export service.

**AI-113 · Automatic insight cards** — کارت‌های بینش خودکار
- P1 · AI: yes · Family: Analytics · Modules: analytics, slm, incident, request
- Sources: Freshservice (Freddy AI Insights: Majority, Outliers, Trend change, Longest increase/decrease, Recent change, Overall trend; root-cause tree map "Leading causes could be"; daily, weekly and monthly runs with minimum history; criticality colours), ServiceNow (KPI Signals; Spotlight; Insights and Opportunities; Analyze Task Trends), JSM (chart insights), SysAid (weekly AI Insights digest with recommendations), ManageEngine (Zia Insights; AI Insights panel), HaloITSM (AI report creators), BMC (ITSM Insights).
- What/how: Classical algorithms compute each insight: majority share ≥ 40%; MAD or Tukey outliers; PELT change points; run length for longest rises; Mann–Kendall with Sen's slope for trend; mix-vs-rate or Shapley decomposition for root-cause tree maps. Cards are ranked by effect size × business weight × novelty, and the LLM writes one or two sentences per card from the computed facts only. Cards respect the viewer's scope; users can subscribe or set alerts.
- Build: insight-engine jobs; `insight_card`; digest notifications.

**AI-114 · "Explain this number"** — «این عدد را توضیح بده»
- P1 · AI: yes · Family: Analytics · Modules: analytics, all dashboards
- Sources: analytics_ux ("explain this number" on every tile: drill to live records and snapshots, statistical signal flags, top contributors, AI narrative, link to the definition), ServiceNow (KPI Signals, Spotlight).
- What/how: Every KPI tile offers its definition and formula version, drill-down to the live records the viewer may see and to the historical snapshot, statistical signal flags, top contributors, and a short AI narrative that cites only computed values.
- Build: tile action; metric metadata; narrative skill.

**AI-115 · Report and dashboard narratives** — روایت خودکار گزارش و داشبورد
- P1 · AI: yes · Family: Analytics · Modules: analytics, slm, cmdb, event
- Sources: Atlassian (chart insights describe a chart in text), ServiceNow (Summarize CMDB readiness turns dashboards into findings; Service Observability summarisation), HaloITSM (AI report summaries with next-step recommendations), Freshservice (Insights summaries), BMC (multilingual PDF export), ManageEngine (auto-written chart narratives).
- What/how: One click writes an executive summary of a dashboard or report (what changed, where, likely drivers, suggested actions) in Persian or English; numbers are validated against the data; the summary regenerates when filters change.
- Build: narrative skill with a number validator.

**AI-116 · Forecast widgets** — ویجت‌های پیش‌بینی
- P1 · AI: yes · Family: Analytics · Modules: analytics, workforce, slm, financial
- Sources: HaloITSM (forecasting), ServiceNow (Platform Analytics forecasts), JSM (30-day forecast with confidence band), standards (forecasting of volumes, breaches and costs).
- What/how: Any time-series metric can show a forecast with prediction intervals, with seasonality that knows the Jalali calendar and Iranian holidays such as Nowruz; back-test accuracy is displayed.
- Build: forecasting service shared with AI-052 and AI-105.

**AI-117 · Natural-language list, queue and filter builder** — ساخت فهرست، صف و فیلتر با زبان طبیعی
- P1 · AI: yes · Family: Analytics · Modules: platform, all lists
- Sources: JSM (`/manage-queue`: natural language → JQL queue definition and columns), ManageEngine (Ask Zia smart ticket views; Zia-powered global search), ServiceNow (Search CMDB natural language → query).
- What/how: "My team's unassigned P2s older than two days on the network service" becomes a filter AST shown as chips and can be saved as a list, queue or view. It works across record types and never bypasses permissions.
- Build: question-to-filter skill; filter-AST compiler.

**AI-118 · Free-text feedback theme extraction** — استخراج مضمون از بازخوردهای متنی
- P1 · AI: yes · Family: Analytics · Modules: slm, portal, csm, analytics
- Sources: JSM (per-question survey Insights summaries), standards (experience drivers from free-text survey comments by topic clustering), analytics_ux (Persian CSAT/CES/NPS micro-surveys with AI theme extraction), Zendesk (QA).
- What/how: Clusters and labels CSAT/NPS comments, complaints and survey answers into themes with sentiment and trends, links each theme to example records, and feeds experience (XLA) dashboards.
- Build: clustering and labelling jobs; theme tables.

**AI-119 · Process mining with AI** — کاوش فرایند با هوش مصنوعی
- P2 · AI: yes · Family: Analytics · Modules: analytics, all process modules
- Sources: ServiceNow (Process Mining with Now Assist: Process Inefficiency Highlights from work notes; templates for mining agentic AI logs; Task Mining), ai.md (event log from audit history; directly-follows graph; variants; conformance; ping-pong loops; bottlenecks).
- What/how: Builds event logs from the audit trail, discovers process maps with frequency and duration overlays, finds variants, ping-pong reassignment loops and bottlenecks, checks conformance with the reference model and explains the main inefficiencies with variant ids and counts.
- Build: event-log extraction; discovery algorithms; narrative skill.

**AI-120 · Automation opportunity discovery** — کشف فرصت‌های خودکارسازی
- P1 · AI: yes · Family: Analytics · Modules: analytics, request, service_portfolio, ai
- Sources: ServiceNow (AIOps LEAP groups automation opportunities; Now Assist for Automation Center; Automation Discovery deprecated), BMC (Service Optimizer and Catalog Service Sensor find savings in conversation data), ai.md (opportunity score).
- What/how: Score per ticket cluster = volume × median handle time × repeatability × automatable × (1 − existing automation coverage), where "automatable" is judged by an LLM against the available actions and connectors. The ranked backlog shows estimated hours saved per month, and one click drafts an agent or a procedure.
- Build: clustering and scoring job; opportunity records.

**AI-121 · Catalog and portfolio gap insights** — بینش شکاف‌های کاتالوگ و سبد خدمات
- P2 · AI: yes · Family: Analytics · Modules: service_portfolio, request
- Sources: BMC (Catalog Service Sensor ranks missing services by cost and time savings), ai.md (demand with no catalog item; unused items; high incident-to-request ratios; portfolio memo), ITIL (duplicate and overlapping service detection), standards.
- What/how: A quarterly analysis per service of demand without a catalog item, items with almost no use (retirement candidates), overlapping services and high incident-to-request ratios, with an LLM-drafted portfolio memo that cites the clusters.
- Build: analysis job; memo skill.

#### 8. Knowledge and smart documents

The knowledge AI features live in the knowledge module (see the family table). The features below are the document and grounding capabilities shared by all modules.

**AI-122 · Smart document Q&A (ask, summarise, compare, extract)** — پرسش‌وپاسخ هوشمند روی اسناد
- P0 · AI: yes · Family: Knowledge · Modules: knowledge, esm, supplier, security, all (attachments)
- Sources: ServiceNow (record navigation, visual Q&A and document Q&A workflow; Vision AI Agent; attachment summarisation), Freshservice (AI Agent over uploaded files), SysAid (Data Pool documents), InvGate (answers from DOC/DOCX/PDF), ManageEngine (Solution Assist over attachments), JSM (Create with Rovo over PDFs), BMC (document library), standards (contract clause extraction).
- What/how: Users pick a collection, a folder, several documents or a record's attachments and ask questions. Answers cite page and paragraph and open the viewer at the cited spot. Long documents can be summarised; two documents or two versions can be compared (what changed, where they conflict); tables and key facts can be extracted into fields. Personal collections are private to one user. Everything follows the document's audience and AI policy; scanned Persian documents work through OCR.
- Build: retrieval over `doc_document` chunks with page references; comparison skill (section diff); extraction to JSON.

**AI-123 · Document intelligence extraction** — استخراج هوشمند داده از اسناد
- P1 · AI: yes · Family: Knowledge · Modules: itam, supplier, financial, esm, security
- Sources: ServiceNow (DocIntel: invoices, forms, contracts; contract entitlement extraction; contract obligation extraction with reviewer accept/reject), Flexera (contract and entitlement ingestion from contracts, invoices, purchase orders and quotes), ai.md (strict JSON schema with page and quote evidence; side-by-side verification; licence math stays deterministic), standards (contract clause extraction with gap checks; invoice and contract data extraction).
- What/how: Contracts, invoices, quotations, forms and official letters are extracted into a strict schema (for example publisher, product, licence metric, quantity, term, unit cost, currency, obligations; for Iranian invoices the seller, economic code and amounts), with page and quote evidence for each field. A side-by-side verification screen lets a person accept values, which then create or update records (entitlements, obligations, contract terms).
- Build: OCR/text → segmentation → schema-bound LLM extraction; review UI; record mapping.

**AI-124 · Attachment summarisation and Q&A in records** — خلاصه و پرسش از پیوست‌های رکورد
- P1 · AI: yes · Family: Knowledge · Modules: incident, request, change, problem, csm
- Sources: ServiceNow (attachment summarisation for PDFs and images), BMC (Service Collaborator reads activity-note and change attachments, 26.3), JSM (Request Resolver reads attachments), ManageEngine (Solution Assist processes attachments).
- What/how: Summarises logs, PDFs, spreadsheets and images attached to a record and answers questions about them in the panel; long log files are parsed into errors and a timeline; results can be saved as a work note.
- Build: AI-122 pipeline scoped to the record's attachments, which inherit the record's keys.

**AI-125 · Grounding corpus management (data pool)** — مدیریت منابع پایه پاسخ‌گویی
- P1 · AI: yes · Family: Knowledge · Modules: ai, knowledge, portal
- Sources: SysAid (Data Pool: service-record data, Q&A sets, KB articles, documents, URLs; Monitor & Fine-Tune), Freshservice (knowledge sources per AI agent; filtered search per agent or request type), BMC (dynamic tags filter knowledge by role, permission and location; admin decides on internal articles), Atlassian (agent knowledge sources), InvGate (each agent's own knowledge scope).
- What/how: Admins decide which sources each assistant or agent may use (bases, collections, snippet sets, connectors, record types) with filters (language, department, product), preview what a given user would retrieve, and watch quality per source (coverage, freshness, grounding rate).
- Build: `rag_source` and per-agent source scopes; preview that runs under the selected user's predicate.

#### 9. Asset and CMDB AI

**AI-126 · Natural-language CMDB query** — پرسش از CMDB با زبان طبیعی
- P1 · AI: yes · Family: Asset/CMDB · Modules: cmdb, itam, change, incident
- Sources: ServiceNow (Search CMDB: keyword, dot-walk or multi-table relationship queries), Atlassian Rovo (Assets schemas → AQL, read-only), NetBox Copilot (unverified), ITIL ("what depends on X?"), standards (natural-language querying of the service graph under the caller's permissions).
- What/how: Using compact schema cards of the relevant classes, the question becomes a structured query AST {class, filters, traverse, fields} that is validated against the schema and executed through the access layer. The generated query is shown so users learn it; unbounded graph scans are rejected.
- Build: schema-card retrieval; question-to-AST skill; validator.

**AI-127 · Duplicate CI remediation** — رفع پیکربندی‌های تکراری
- P1 · AI: yes · Family: Asset/CMDB · Modules: cmdb, itam
- Sources: ServiceNow (Duplicate CI Remediator with reasoning at each step; Manage duplicate CIs skill with preview and root cause), BMC (CMDB Governor), ITIL v5 (curation: duplicate CMDB records), standards (fuzzy-matching reconciliation).
- What/how: Blocking keys (serial number, MAC, cloud resource id, SMBIOS UUID, hostname + domain) and pair features (Jaro–Winkler names, IP overlap, same model, same location, last-discovered gap) feed probabilistic linkage (Fellegi–Sunter or a model trained on admin decisions). The survivor is chosen deterministically by source precedence and recency. The LLM explains the merge and the likely root cause (e.g., two discovery sources with different identification rules). Merges are previewed and reversible through an undo journal.
- Build: de-duplication job; merge service; explanation skill.

**AI-128 · CMDB data-quality governor** — ناظر کیفیت داده CMDB
- P2 · AI: yes · Family: Asset/CMDB · Modules: cmdb
- Sources: BMC (CMDB Governor: data-quality issues, root-cause analysis, recommended fixes), ServiceNow (CMDB governance advisor; Summarize CMDB readiness; Service Graph Connector diagnosis), ITIL (attribute anomaly detection).
- What/how: Turns health metrics (completeness, correctness, compliance, staleness, orphans) into prioritised findings with root cause and fix steps, and explains connector import errors.
- Build: health KPIs plus a findings skill.

**AI-129 · Relationship inference** — استنتاج روابط بین پیکربندی‌ها
- P2 · AI: yes · Family: Asset/CMDB · Modules: cmdb, event, change
- Sources: market gap (no vendor documents ML-proposed CI relationships as a CMDB feature); ITIL (relationship inference from traffic and logs), standards (from network flows and traces), Freshservice/Device42 (application dependency mapping), ServiceNow (traffic-based service mapping suggestions).
- What/how: Proposes "depends on", "connects to" and "runs on" edges from observed connections, co-occurrence of CIs in incidents, alerts and changes (association rules with lift > 3 and support ≥ 5) and LLM parsing of connection strings and config files. Owners accept or reject with the evidence shown; accepted edges carry `source = ai_suggested`.
- Build: inference jobs; suggestion queue.

**AI-130 · Conversational CI creation** — ایجاد پیکربندی با گفت‌وگو
- P2 · AI: yes · Family: Asset/CMDB · Modules: cmdb, itam
- Sources: ServiceNow (Create configuration item workflow: confirm class, check identification rules, ask for missing data, check duplicates, create).
- What/how: For assets discovery cannot see (OT, physical equipment), the assistant collects the identifying attributes the class's identification rule needs, checks for an existing match first (offering an update instead) and then creates the CI.
- Build: slot schema generated from identification rules; reconciliation "identify" step.

**AI-131 · Software and hardware normalisation** — یکسان‌سازی نام نرم‌افزار و سخت‌افزار
- P1 · AI: yes · Family: Asset/CMDB · Modules: itam, cmdb, financial
- Sources: ServiceNow (candidate match review against the SAM content library, Otto for SAM 13.0.0; daily hardware model normalisation that never overwrites original fields), Flexera (Technopedia), Ivanti, ManageEngine, ITIL (software title normalisation), standards.
- What/how: Alias table → regex parsing of version, edition and architecture → embedding nearest neighbours in the catalogue → LLM adjudication of the top five with confidence and reason → automatic mapping at ≥ 0.95, otherwise a review queue. Human decisions feed the alias table; normalised values live in separate fields and raw values are kept.
- Build: catalogue, alias table, review queue.

**AI-132 · Asset insights and completeness suggestions** — بینش دارایی و پیشنهاد تکمیل داده
- P1 · AI: yes · Family: Asset/CMDB · Modules: itam, cmdb
- Sources: JSM (Rovo hardware insights: expiring warranties, low stock, dormant "ghost" devices, incomplete models, over-assigned and incident-prone assets, answered by deterministic queries phrased by AI), ServiceNow (asset analysis summary; Generate asset insights), InvGate (Atlas AI Agent: end-of-life data and suggested missing fields with reasoning; data-completeness score).
- What/how: An insight panel with prebuilt questions answered by deterministic queries and phrased by AI, plus suggestions for missing fields (model, end-of-life dates, warranty) with sources and reasoning for a person to accept.
- Build: insight queries; suggestion records.

**AI-133 · Licence optimisation and reclamation** — بهینه‌سازی و بازپس‌گیری مجوزها
- P2 · AI: yes · Family: Asset/CMDB · Modules: itam, financial
- Sources: ServiceNow (reclamation rule recommendations; Evaluate Software Reclamation; publisher compliance summaries and recommended actions), Flexera, ITIL (licence optimisation recommendations), standards (reclaim and rightsizing recommendations).
- What/how: Candidates (no use in N days, duplicate installations, downgrade where premium features are unused) are ranked by savings × confidence. AI drafts the user notification and the asset manager's summary; execution goes through the approval-gated uninstall or unassign workflow; licence math stays deterministic.
- Build: reclamation job; workflow.

**AI-134 · Spend detection, cost anomalies and forecasting** — کشف هزینه، ناهنجاری هزینه و پیش‌بینی
- P2 · AI: yes · Family: Asset/CMDB · Modules: financial, itam
- Sources: ServiceNow (software spend detection in financial transactions, Otto for SAM 11.0.0; cloud cost anomaly detection), standards (spend anomaly detection; cost forecasting; suggested allocation keys; invoice data extraction), ITIL (invoice anomaly detection), FinOps tools.
- What/how: A cheap classifier flags software lines in transactions and the LLM extracts publisher, product and term only from those lines. Cost anomalies per cost centre and service (STL with robust z-score and a currency floor) are explained from the top line items; forecasts carry intervals; allocation keys are suggested from usage correlation.
- Build: finance jobs; explanation skill.

**AI-135 · SaaS account resolution** — تطبیق حساب‌های SaaS با افراد
- P2 · AI: yes · Family: Asset/CMDB · Modules: itam, access
- Sources: ServiceNow (AI user resolution for SaaS subscriptions; SaaS connection error resolution).
- What/how: Matches SaaS accounts to people: exact e-mail → normalised e-mail (aliases, plus-addressing) → UPN and IdP ids → fuzzy name plus domain → LLM tie-break with evidence; never merges on name alone; explains connector errors.
- Build: matching job; review queue.

**AI-136 · Configuration drift and software anomaly detection** — کشف انحراف پیکربندی و نرم‌افزار غیرمجاز
- P2 · AI: yes · Family: Asset/CMDB · Modules: itam, cmdb, security
- Sources: Freshservice (ITAM configuration-drift detection; AI involvement unverified), ManageEngine (Endpoint Central anomalies: prohibited and unlicensed software), standards (configuration-drift anomaly detection; SaaS usage anomalies), ITIL (unexpected installs, shadow SaaS).
- What/how: Compares discovered configurations with baselines, flags drift, prohibited or unlicensed software and shadow SaaS, explains the impact and proposes tasks.
- Build: drift job; tasks.

**AI-137 · Hardware failure and refresh prediction** — پیش‌بینی خرابی و زمان نوسازی سخت‌افزار
- P2 · AI: yes · Family: Asset/CMDB · Modules: itam, field_service
- Sources: ITIL (refresh forecasting from failure data; predictive maintenance), standards (hardware failure and refresh prediction from telemetry).
- What/how: Predicts failure probability and the best refresh time per device model from age, incidents, telemetry (disk SMART data, battery health) and warranty, feeding refresh plans and budgets.
- Build: survival model per hardware model; refresh report.

#### 10. Builder and admin AI

**AI-138 · AI-led implementation agents** — عامل‌های پیاده‌سازی و پیکربندی با هوش مصنوعی
- P1 · AI: yes · Family: Builder · Modules: admin, all
- Sources: ServiceNow (Simplified ITSM configuration agents for SSO, groups and roles, data imports, categories, routing rules, SLAs, notifications, change models, risk questions and thresholds, CAB with document upload, change schedules; AI-guided Implementation Planner; Integration Management agent; Text-to-Configuration), BMC (Custom Data Integrator), Atlassian (create a service space with Rovo; Create with Rovo knowledge setup).
- What/how: A conversational setup that reads uploaded policies (PDF, DOCX, XLSX), interviews the admin and proposes configuration — groups, categories, SLAs with Jalali calendars and Iranian holidays, routing, notifications, change models, risk questionnaires, CAB — as a reviewable change set applied to the sandbox first. Every item is a proposal.
- Build: configuration agent with metadata tools; sandbox deployment; diff view.

**AI-139 · Natural-language workflow and agent generation** — ساخت گردش‌کار و عامل با زبان طبیعی
- P1 · AI: yes · Family: Builder · Modules: platform, admin, ai
- Sources: InvGate (AI workflow generation: clarifying questions → editable stage plan → workflow with stages, conditions and variables; Workflow Assistant explains a workflow with six months of execution statistics), Freshservice (natural-language workflow generation validated before it is added to an agent), ServiceNow (flow and playbook generation; Now Assist for Creator), JSM (Create flows with Rovo; automation-rule suggestions), Rezolve.ai (Creator Studio), IFS/TheLoops (agent builder), Atlassian Rovo Studio.
- What/how: The admin describes a process (who, when, approvals, outcomes); the AI asks clarifying questions, shows an editable plan, then generates the workflow graph or an agent definition to finish in the visual builder, validated before activation. "Explain this workflow" narrates any graph with its execution statistics.
- Build: generator emitting the workflow JSON schema; validator; simulator.

**AI-140 · Form, request-type and catalog item generation** — ساخت فرم، نوع درخواست و آیتم کاتالوگ
- P1 · AI: yes · Family: Builder · Modules: request, platform, admin, service_portfolio
- Sources: ServiceNow (Catalog Item Generation: items, variables, mappings and dynamic behaviour from a description), JSM (Create request types using AI; Suggest fields; `/manage-request-type`), BMC (Catalog Curator: services, questionnaires with conditional logic, cost adjustments, workflows, approvals, surveys; IS RD Agent builds record definitions and processes from a conversation), ITIL (catalogue-item drafting), standards (plain-language catalogue descriptions checked for readability and accessibility).
- What/how: From a description such as "laptop request for engineers with manager approval", generates a catalog item or record type: typed fields, validation, conditional visibility, approval steps, fulfilment tasks, Persian labels and help text, with a readability check. The admin edits before publishing.
- Build: generator to metadata JSON; preview; publish as a normal configuration change.

**AI-141 · Rule and condition generation** — ساخت قانون و شرط با زبان طبیعی
- P1 · AI: yes · Family: Builder · Modules: platform, slm, workforce, admin
- Sources: ServiceNow (natural-language condition evaluation; Text-to-Configuration for AIOps rules), monday service (sentence-style automation recipes), JSM (automation-rule suggestions), ITIL.
- What/how: "Escalate VIP P1 incidents not acknowledged within 10 minutes to the duty manager by SMS" becomes a rule (trigger, conditions, actions) shown both as a readable sentence and as a form, and is simulated against recent records ("would have fired 14 times last week") before saving.
- Build: question-to-rule AST; simulator over history.

**AI-142 · Code and script generation and explanation** — تولید و توضیح کد و اسکریپت
- P1 · AI: yes · Family: Builder · Modules: platform, admin
- Sources: ManageEngine (Custom Script Generator; Code Generator for custom functions with BYOK models), ServiceNow (text-to-code with explanations; Impact Code Fix Agent explains platform errors with fix guidance), ITIL (code generation).
- What/how: Generates and explains the scripts the platform allows (custom functions, transforms, formulas, regular expressions, templates) and explains errors from logs in plain language with a suggested fix. Generated code runs in the sandbox with tests before deployment.
- Build: code skill with platform API documentation as context; sandbox runner.

**AI-143 · Import mapping assistant** — دستیار نگاشت داده‌های ورودی
- P1 · AI: yes · Family: Builder · Modules: platform, itam, cmdb, admin
- Sources: ServiceNow (AI Lens maps spreadsheet columns to fields, choice values and references and fills forms from the screen; entitlement-import error resolution), ManageEngine (downloadable failed rows), BMC (validated spreadsheet imports).
- What/how: On Excel/CSV import, the AI proposes column-to-field mapping, value mapping to choices (including Persian and English variants) and references (fuzzy matches to users, CIs and locations), explains failed rows and proposes fixes for the user to confirm.
- Build: mapping skill; import preview.

**AI-144 · Questionnaire and survey generation** — تولید پرسش‌نامه و نظرسنجی
- P2 · AI: yes · Family: Builder · Modules: slm, change, continuity, csm, portal
- Sources: JSM (Create with Rovo surveys from goal and audience; `/create-survey`), BMC (Survey Assistant with translations, rating scales and delivery settings), Freshservice (AI-generated change risk surveys), standards (BIA questionnaires).
- What/how: From a goal and audience, drafts satisfaction surveys, change risk questionnaires and BIA questionnaires with scales, branching and translations, following best practice (short, neutral questions).
- Build: generator to the questionnaire schema.

**AI-145 · Policy authoring copilot** — دستیار نگارش سیاست‌های دسترسی
- P1 · AI: yes · Family: Builder · Modules: access, admin
- Sources: access.md (recommended: turns an admin's description into draft roles, grants, restrictions or audiences, which must pass the who-gains/who-loses simulator and approval), ServiceNow (configuration agents for groups and roles).
- What/how: "Engineers at the Tabriz site can see all network incidents but nothing in HR" becomes a draft grant, restriction or audience; the simulator shows who gains and who loses access; publishing needs approval and step-up authentication.
- Build: question-to-policy AST; simulator; approval.

**AI-146 · Access explainer** — توضیح‌دهنده دسترسی
- P1 · AI: yes · Family: Builder · Modules: access, all
- Sources: access.md (narrates the deterministic explain trace — "why can't I see INC-123?" — and never decides access), ServiceNow (Access Analyzer; User Criteria Diagnostics), Moveworks (Permissions Checker).
- What/how: Users and admins ask why a record is or is not visible or editable; the deterministic explain trace is narrated in Persian with links to the rules involved, and the assistant suggests whom to ask for access.
- Build: explain API; narration skill.

**AI-147 · AI-assisted access reviews and role mining** — بازبینی دسترسی و کشف نقش با کمک هوش مصنوعی
- P2 · AI: yes · Family: Builder · Modules: access, security
- Sources: access.md (summaries of last use, peer comparison and SoD conflicts with proposed revocations; role mining that clusters real permission usage into leaner roles and highlights toxic combinations), ServiceNow (Veza access graph).
- What/how: In review campaigns, each assignment shows last use, peers' access and SoD conflicts with a recommendation; role mining proposes leaner roles; reviewers decide.
- Build: usage analytics; clustering; review UI.

**AI-148 · Anomalous access detection** — کشف دسترسی غیرعادی
- P2 · AI: yes · Family: Builder · Modules: access, security, ai
- Sources: access.md (models per user, integration and AI agent: unusual record volumes, scope jumps, off-hours bulk reads, repeated denials), ServiceNow AI Control Tower (agents acting beyond their permissions), Atlassian Guard (anomalous-activity detections).
- What/how: Baselines per principal (people, integrations, AI agents) flag unusual reads and exports, scope expansions and bursts of denials, raising security events and optionally pausing an AI agent automatically.
- Build: access-log analytics; anomaly models; security events.

**AI-149 · Sensitive-data classifier for records** — طبقه‌بند داده حساس در رکوردها
- P1 · AI: yes · Family: Builder · Modules: platform, security, esm, knowledge, all
- Sources: access.md (detects credentials, personal and HR data in descriptions, comments and attachments; masks the field; proposes classification or restriction), standards (PII detection and redaction in ticket text, attachments, chat transcripts and AI prompts; special-category tags; GDPR, ISO/IEC 27701), ServiceNow (Data Discovery), ManageEngine (PII marking and field encryption).
- What/how: Scans text and attachments for passwords and keys, national IDs, card numbers, IBAN/Sheba, phone numbers and health or HR data; masks secrets automatically and proposes redaction or classification for the rest; tags records for privacy reporting.
- Build: regex plus Persian/English NER; masking actions; privacy tags.

**AI-150 · Configuration test generation** — تولید آزمون برای پیکربندی‌ها
- P2 · AI: yes · Family: Builder · Modules: admin, platform
- Sources: ServiceNow (ATF Test Agent generates automated test steps), Freshservice (Test Case Generator).
- What/how: Generates test scenarios (inputs and expected outcomes) for workflows, forms, SLAs and rules and runs them in the sandbox before promotion.
- Build: test generator; test runner.

**AI-151 · App builder agent** — عامل سازنده برنامه
- P2 · AI: yes · Family: Builder · Modules: platform, admin
- Sources: ServiceNow (Build Agent with Spec Mode; Autonomous Engineer builds and tests in the background), BMC (IS RD Agent), ManageEngine (custom modules).
- What/how: From a specification, builds a new module on the metadata engine (record types, fields, forms, lists, states, rules, roles, dashboards) in the sandbox with generated tests; people review the change set before promotion.
- Build: agent with metadata tools; sandbox; change set.

**AI-152 · In-app help assistant** — دستیار راهنمای درون‌برنامه
- P2 · AI: yes · Family: Builder · Modules: platform, portal, admin
- Sources: BMC (DocuAssistant help assistant for signed-in users, 26.1), Atlassian Rovo (Definitions).
- What/how: Answers "how do I…?" questions from the product help and the tenant's own configuration (forms, workflows, catalog) in Persian, with links to the right page and step-by-step guidance.
- Build: retrieval over help content and configuration metadata.

#### 11. Governance, safety and economics

**AI-153 · AI control centre** — مرکز کنترل هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: ai, admin
- Sources: ServiceNow (Now Assist admin console / Now Assist Center; AI Control Tower: Discover, Observe, Govern, Secure, Measure), Alemba (per-capability on/off switches; every AI action logged), TOPdesk (AI settings; every AI feature off by default), SysAid ("AI Admin" permission), Atomicwork (single AI control plane), BMC (HelixGPT Manager; Agent Outcomes).
- What/how: One console listing providers, models, skills, agents, tools, MCP servers and connectors with owner, status, usage, cost and quality. Every feature starts off and is enabled per tenant, domain, workspace, department or role, optionally for a pilot group first. Links lead to evaluations, AI incidents and the register.
- Build: admin pages over the AI tables; hierarchical feature flags.

**AI-154 · AI identities, run-as and permission intersection** — هویت هوش مصنوعی، اجرا به‌جای کاربر و اشتراک دسترسی‌ها
- P0 · AI: yes · Family: Governance · Modules: ai, access, all
- Sources: ServiceNow (dynamic user vs AI-user identity; role masking = caller's roles ∩ allowed roles; downstream ACL conjunction; deny-by-default for agentic resources without ACLs; "Investigate and resolve" runs as Assigned to), Atlassian (Rovo acts as the invoking user; agent's account with organisation, app and user access layers; actions credited to the agent), HaloITSM (AI Agents authorise as a chosen Application), ManageEngine (system-defined Zia Agent roles; ZiaVerifier role), BMC (agentic AI pinned to the ticket's company), access.md (two identity modes; user ∩ agent ∩ channel).
- What/how: Assist mode runs as the user: allowed = user_can ∩ agent_tools_allow ∩ ai_channel_allows. Autonomous agents are `ai_agent` principals with explicit minimal grants (no shared super-account). Role masks narrow what a caller lends to an agent; the identity must pass every tool's permission; actions are attributed to the agent and to the person who triggered or approved them; context is pinned to the record's domain or company; an AI can never approve what it proposed.
- Build: principal kind `ai_agent`; role mask; attribution columns `acted_by_ai`, `ai_run_id`, `on_behalf_of_user_id`.

**AI-155 · Invocation, builder and log permissions** — مجوزهای اجرا، ساخت و مشاهده لاگ هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: ai, access, admin
- Sources: ServiceNow (invocation ACLs on skills, agents, agentic workflows and flows: any authenticated user, specified roles (default) or public; Deny-Unless rules; warning banners for agents without ACLs; ACLs on context-menu skills), Atlassian (Rovo Studio: who may create agents — all, up to 10 groups, none; per-agent sharing), Freshservice (Copilot per role and licence; Manage AI Agent Studio permission; known gap: conversation logs readable workspace-wide), SysAid (AI Admin), BMC (HelixGPT Admin and Agent Studio roles), Zammad (`admin.ai_agent`).
- What/how: Separate permissions to use a skill or agent (an audience per skill), build agents and skills, administer providers, approve MCP servers and read AI conversation and run logs. New agents and tools are denied until granted. Logs inherit the access of the user and records involved, closing Freshservice's workspace-wide log exposure.
- Build: grants on AI resources; audience bindings with mode `can_invoke`; log-access predicate.

**AI-156 · AI-channel policy** — سیاست کانال هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: ai, access, knowledge, all
- Sources: Atlassian (MCP control in data security policies per organisation, site, object or classification; blocked items behave as nonexistent), Microsoft 365 (Restricted Content Discovery; EXTRACT usage right — link instead of summarise), BMC (company pinning), access.md (an AI-channel policy stricter than access: secret and sensitive never; HR and security only in their own partitions).
- What/how: Per tenant, domain, workspace, record type, knowledge base, classification and channel: AI may read or not, may extract or only link, and which personas and channels (portal, messengers, MCP, offline) are allowed. It can only remove rights. Defaults: secret and sensitive field classes never; HR and security only inside their partitions and assistants; group chats stricter than private chats.
- Build: `ai_channel_policy`; compiled into chunk flags and retrieval predicates; enforced in the gateway and in tools.

**AI-157 · Decision-authority matrix** — ماتریس اختیار تصمیم‌گیری هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: ai, all
- Sources: ITIL v5 (per AI feature and action type: autonomous, act-then-notify, propose-and-approve, advise-only, prohibited; conditions by risk and confidence; approvers by role; rollback required for autonomous actions; escalation boundaries), InvGate (auto / confirm / never), Freshservice (Always allowed / Approval required / Blocked), others.md (conditional policies, e.g. auto only when confidence ≥ 0.8 and the requester is not a VIP).
- What/how: A policy table evaluated at run time for every AI action: the mode by action type and by risk conditions (service criticality, change risk, customer-facing, financial or security impact, confidence, VIP, business hours), approver roles, rollback requirement and who may override; every decision is logged.
- Build: `ai_policy` with a condition AST; evaluated for tool calls and suggestions.

**AI-158 · Confidence thresholds and abstention** — آستانه اطمینان و امتناع از پاسخ
- P0 · AI: yes · Family: Governance · Modules: all
- Sources: ITIL v5 (every suggestion carries a confidence; per-feature thresholds for show, pre-fill and auto-apply; low confidence goes to a human), ServiceNow ("Not determined"; per-class thresholds), ManageEngine (breach prediction with confidence levels), JSM (ICC hypotheses High/Medium/Low; Ops Expert confidence score), BMC (Ticket Resolver confidence decisioning).
- What/how: Each output has a calibrated confidence with per-feature thresholds (show, pre-fill, auto-apply). The UI separates uncertain from confident output with labels and colour-plus-pattern cues for accessibility. Below the threshold the AI abstains or hands over to a person. Calibration curves are monitored.
- Build: calibration per model and skill; thresholds on `ai_skill`; UI components.

**AI-159 · Proposal-based writes with human approval** — نوشتن از راه پیشنهاد با تأیید انسانی
- P0 · AI: yes · Family: Governance · Modules: all
- Sources: access.md (structured change proposal with target, diff, reason and sources; confirmation runs the normal write path with validation, rules, SoD and audit; high-risk actions need approval by someone else), ServiceNow (agents show recommendations before updating; TPRM issues and project risks saved as drafts until confirmed), InvGate (responses never sent automatically), PagerDuty (approval by default), BMC (CAB Supervisor never updates records), TOPdesk.
- What/how: Every AI write (field change, transition, message to a requester, bulk update, approval, access grant) is a proposal card with diff and sources. Confirmation runs the normal mutation path. High-risk proposals (closing a P1, approving a change, granting a role, bulk changes, external messages) need explicit approval, possibly by another person. Proposals expire.
- Build: `ai_proposal`; executor reusing the standard server actions; approval integration.

**AI-160 · Prompt-injection defence in depth** — دفاع چندلایه در برابر تزریق پرامپت
- P0 · AI: yes · Family: Governance · Modules: ai, all
- Sources: ServiceNow (Now Assist Guardian prompt-injection detection with log or block modes and Low/Medium/High sensitivity; always-on blocking for skills reported in 2026), Azure AI Content Safety Prompt Shields (recommended by BMC), OWASP LLM Top 10 2025 (LLM01, LLM06, LLM07), arXiv 2506.08837 (action-selector, plan-then-execute, LLM map-reduce, dual LLM, code-then-execute, context-minimisation), ai.md (taint rule; output filters; red-team suites in CI), access.md (quarantined reader; markdown image and link sanitising; host allow-lists).
- What/how: Untrusted text (e-mails, comments, articles, web pages, attachments, tool output) is wrapped as labelled data and can never change identity, tool allow-list or policy. An injection classifier runs in log mode, then block mode. Each skill gets only the tools it needs. Taint rule: write-high or external-send calls whose arguments come from untrusted content require human confirmation. Constrained patterns are used where possible (action-selector for triage, plan-then-execute for runbooks, a tool-less quarantined reader for e-mails and attachments). Output is sanitised (no auto-loaded images; links only to allow-listed hosts). Red-team suites run in CI.
- Build: classifier tier; prompt wrappers; taint tracking in the runtime; CI suite.

**AI-161 · Personal-data masking with reversible placeholders** — پوشاندن داده شخصی با جانشین برگشت‌پذیر
- P0 · AI: yes · Family: Governance · Modules: ai, all
- Sources: ServiceNow (Data Privacy for Now Assist: two-way masking with placeholders or synthetic values; configurable data types), Salesforce (Einstein Trust Layer masking; zero data retention), Atlassian (Rovo Chat security announced), BMC (no built-in masking — a gap to avoid), ai.md (regex plus NER; re-hydration only for users allowed to see originals; no raw PII in shared embeddings; only the redaction-map hash is logged).
- What/how: Before any call to an external model, detected personal data (names, national ID, mobile, e-mail, address, card number, IBAN/Sheba, postal code, IPs per policy) is replaced by placeholders such as `<PERSON_1>` and restored in the response only for users allowed to see the originals. Pattern libraries are per tenant; sovereign local mode may relax masking by policy; masking events are logged.
- Build: masking middleware in the gateway; NER model; redaction map kept in memory only.

**AI-162 · Output safety filters** — پالایش ایمنی خروجی
- P1 · AI: yes · Family: Governance · Modules: ai, portal, csm, esm
- Sources: ServiceNow (Guardian offensiveness detection; sensitive-topic filters redirecting HR topics to a fallback topic), Zendesk (brand voice and tone), ai.md (brand voice and banned phrases validated by a classifier), Salesforce (toxicity scoring).
- What/how: Screens outputs for toxic, defamatory or fraudulent content, for sensitive topics (HR grievances, medical, legal, self-harm) that must go to a person or a fixed topic, and for brand-voice violations and banned phrases; log or block per surface.
- Build: classifier tier; per-surface policy.

**AI-163 · Data residency, provider allow-lists and retention** — محل نگهداری داده، فهرست مجاز ارائه‌دهندگان و نگهداشت
- P0 · AI: yes · Family: Governance · Modules: ai, admin, security
- Sources: TOPdesk (data stays in region; no training on customer data), Salesforce (zero data retention at the provider), Atomicwork (data sovereignty in US, EU or APAC), access.md (allow-lists of providers and regions per tenant or domain; retention of prompts and outputs; no training on tenant data), ManageEngine (regional data centres), standards (GDPR).
- What/how: Per tenant or domain: allowed providers and regions, required provider data policies, whether prompts and outputs are stored, for how long and where. Tenant data is never used to train shared models; AI logs can be exported or deleted on request.
- Build: policy checks in the gateway; retention jobs.

**AI-164 · Transparency labels and AI disclosure** — برچسب شفافیت و اعلام استفاده از هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: all
- Sources: ServiceNow (AI Lens gradient on AI-filled fields), TOPdesk (AI output labelled), HaloITSM (AI provenance flags on tickets, actions and KB articles naming the creating virtual agent, AI agent or MCP tool collection), InvGate (AI assignments logged in ticket history), BMC (AI work recorded in the ticket), Zammad (visible AI presence), standards (EU AI Act Art. 50(1) disclosure in chat; Art. 50(2) machine-readable marking).
- What/how: AI-generated or AI-filled content keeps a label until a person edits or validates it; records created by AI carry provenance (agent, tool, run); the assistant tells users they are talking to an AI; generated documents carry machine-readable marks; exports keep the labels.
- Build: provenance columns; label components; export metadata.

**AI-165 · Explainability and audit trail for every AI output** — توضیح‌پذیری و ردپای ممیزی هر خروجی هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: all
- Sources: ITIL v5 (inputs and sources, model and version, prompt version, confidence, rationale, human decision, downstream actions; visible in the record timeline; exportable), ISO/IEC 42001, Xurrent (ITSM agent audit log, Aug 2026), ServiceNow (agentic AI logs), standards (append-only audit; AI-initiated changes carry AI system id, model/version and the human approver).
- What/how: Every AI output on a record can show its "why": cited sources, model and prompt version, confidence, main factors (for predictions), who accepted or edited it and what followed. Entries are append-only and exportable for audits and post-incident reviews.
- Build: `ai_invocation` and `ai_run` linked to records; timeline entries; hash-chained audit log.

**AI-166 · Run observability and traces** — رصد اجرای عامل‌ها و ردگیری
- P0 · AI: yes · Family: Governance · Modules: ai, admin
- Sources: ServiceNow (AI Control Tower Observe, built on Traceloop; AI Agent Studio execution traces), Datadog (Agent Trace view), Moveworks (Data Ingestion View), access.md (`ai_run` traces with identity, on-behalf-of, retrieved record ids, tool calls with arguments and results, approvals, model and version, tokens and cost; anomaly alerts).
- What/how: A trace viewer per run and invocation: reasoning steps, retrieved items (ids only), tool calls with arguments and results, approvals, latency, tokens and cost, filterable by agent, skill, user and outcome. Alerts fire on unusual volumes, repeated denials and cost spikes.
- Build: trace storage with retention; viewer UI; alert rules.

**AI-167 · Kill switches** — کلیدهای توقف اضطراری
- P0 · AI: yes · Family: Governance · Modules: ai, admin, security
- Sources: ServiceNow (AI Control Tower shuts down agents acting beyond their permissions in real time; AI Gateway instant global pause of any MCP client or server), access.md (disable an agent, tool, provider or all AI per tenant or domain; revoke AI identity tokens), ITIL v5 (feature flags and kill switches; time-to-disable drills).
- What/how: Instantly suspend one agent, tool, provider, MCP client or server, one feature, or all AI for a tenant, domain or workspace. Running jobs stop at their next step, tokens are revoked, the status shows everywhere, and drills record the time to disable.
- Build: flags checked by the gateway and runtime at every step; audit.

**AI-168 · Metering, budgets and quotas** — اندازه‌گیری مصرف، بودجه و سهمیه
- P0 · AI: yes · Family: Governance · Modules: ai, admin, financial
- Sources: Atlassian (Rovo credits; 100 credits per Request Resolver plan; admin limits; alerts at 80% and 100%; usage CSV export), Freshservice (AI Agent sessions = unique user per 24 hours), Zendesk (automated-resolution allowances), ServiceNow (assists per skill or agent run, e.g. Incident Analyzer at 4 assists), ManageEngine (Zia token dashboard), Atomicwork (budgets and spend limits per AI Coworker), BMC (HelixGPT token-usage insights).
- What/how: Meters tokens, cost (from provider price tables), sessions, resolution plans and autonomous resolutions per tenant, domain, workspace, department, user, agent and skill. Budgets alert at 80% and 100% and then warn, degrade to the small tier or stop. Local model usage is measured as GPU time. CSV export.
- Build: `ai_usage` aggregates; `ai_budget`; enforcement in the gateway.

**AI-169 · User feedback on AI output** — بازخورد کاربر روی خروجی هوش مصنوعی
- P0 · AI: yes · Family: Governance · Modules: all
- Sources: Zammad (like/dislike with an optional comment to admins), ManageEngine (feedback on disliked responses; Ask Zia Feedback Trend widget), ServiceNow (share, copy and feedback on summaries; feedback kept in agentic AI logs), JSM (thumbs feedback on similar requests and suggestions), SysAid (Monitor & Fine-Tune).
- What/how: Thumbs up or down with reasons (wrong, incomplete, unsafe, outdated source, wrong language) and comments on every AI output; routed to the skill owner, trended per skill, and selected items become evaluation cases.
- Build: `ai_feedback`; routing; link to evaluation datasets.

**AI-170 · Evaluation harness** — سامانه ارزیابی مهارت‌ها و عامل‌ها
- P1 · AI: yes · Family: Governance · Modules: ai, admin
- Sources: ServiceNow (Agentic Evaluations: LLM judge for task completeness and tool-calling accuracy, sub-metrics combined with AND; Excellent/Good/Moderate/Poor; datasets from tests, logs or the Now Assist Data Kit; Auto-Evaluation for skills; VA automated evaluations), Atlassian (Rovo Agent Evals: CSV datasets up to 100 prompts; response accuracy, resolution rate and manual testing; version comparison), ai.md (golden sets per skill; retrieval recall@k, MRR, nDCG; groundedness and citation precision with judges calibrated by Cohen's κ; classification precision, recall and calibration; regression gates).
- What/how: Golden datasets per skill and agent (from history, curated cases, synthetic generation and feedback) in Persian and English; offline runs on every prompt, model or retrieval change with judge scores and deterministic metrics; side-by-side version comparison; releases blocked when quality drops beyond tolerance; results attached to the register.
- Build: `ai_eval_dataset`, `ai_eval_run`; judge prompts; CI integration.

**AI-171 · Permission-leak tests with canaries** — آزمون نشت دسترسی با رکوردهای قناری
- P0 · AI: yes · Family: Governance · Modules: ai, access, security
- Sources: access.md (canary records in restricted groups, HR cases, other tenants and domains and secret fields carry unique markers; suites ask every assistant under many personas through search, chat, summaries, reports, exports and tools; any marker in an output fails the build), ai.md (synthetic users with narrow ACLs; pass = zero restricted documents retrieved or cited), OWASP LLM02 and LLM08.
- What/how: Automated suites seed canaries and probe every AI surface as many personas (requester, agent of another group, external customer, other domain). They run in CI and on demand in production tenants (read-only); results appear in the control centre; any leak blocks the release.
- Build: AI-assisted adversarial question generator; CI job; dashboard.

**AI-172 · Online quality, drift and fairness monitoring** — پایش برخط کیفیت، رانش و انصاف
- P1 · AI: yes · Family: Governance · Modules: ai, analytics
- Sources: ITIL v5 (acceptance and accuracy, override rate, drift in inputs and outcomes, latency, cost, hallucination reports, fairness across user groups, safety incidents; thresholds create events and incidents), ServiceNow (PI precision and coverage; Now Assist Analytics), SysAid (Monitor & Fine-Tune; Usage Dashboard), ai.md (acceptance, edit distance, deflection, reopen rate, CSAT, cost per resolution).
- What/how: Dashboards per skill, agent and model: acceptance, edit distance, override rate, abstention, sampled groundedness, calibration error, input drift (topic and language mix), outcome drift, fairness gaps (routing or answer quality across departments, sites and genders), latency and errors. Thresholds create events and AI incidents.
- Build: metric jobs over AI tables; alert rules.

**AI-173 · AI value and adoption analytics** — تحلیل ارزش و پذیرش هوش مصنوعی
- P1 · AI: yes · Family: Governance · Modules: ai, analytics
- Sources: InvGate (AI Hub reports: adoption vs engagement per agent; with-AI vs without-AI filter on dashboards), BMC (Service Collaborator Value Dashboard: MTTR, response time, pending duration and SLA adherence for AI-assisted vs non-assisted tickets), ServiceNow (Now Assist Analytics executions and business value; Closed by AI attribution; AI Agent performance dashboard with KB usage), Freshservice (Copilot reports; AI Agent overview), analytics_ux (measured AI cohorts).
- What/how: Adoption (tried) vs engagement (kept using) per user, team and skill; AI-assisted vs non-assisted cohorts (MTTR, FCR, SLA, CSAT, reopen); auto-resolution and deflection volumes; estimated hours saved; cost vs value per skill.
- Build: cohort tagging through run and invocation links; dashboards.

**AI-174 · AI change control** — کنترل تغییرات هوش مصنوعی
- P1 · AI: no · Family: Governance · Modules: ai, change
- Sources: ITIL v5 (prompts, models, thresholds, training data and provider/model versions go through change enablement with risk assessment, approval, staged rollout and rollback), ServiceNow (LTS models; prompt versioning), standards (ISO/IEC 42001 A.6.2.8: persist the model version).
- What/how: Changing a prompt, model, retrieval setting, threshold or agent definition creates a change record — a standard change when evaluations pass, a normal change otherwise — with evaluation evidence, staged rollout (pilot group, then everyone) and one-click rollback.
- Build: integration with the change module; version pinning.

**AI-175 · AI system register (including shadow AI)** — دفتر ثبت سامانه‌های هوش مصنوعی (از جمله هوش مصنوعی پنهان)
- P1 · AI: no · Family: Governance · Modules: ai, cmdb, security, supplier
- Sources: ITIL v5 (register of AI systems, models, agents, prompts and third-party AI services with owner, purpose, 6C capabilities, data sources and classification, provider/model/version, autonomy level, risk tier, regulations, oversight design, evaluation results; lifecycle proposed → assessed → approved → pilot → production → retired; registered as CIs; shadow-AI discovery), ServiceNow (AI Control Tower Discover including shadow AI; CSDM 5 AI system and model classes; AI agent topology mapping), ISO/IEC 42001.
- What/how: Internal AI capabilities (skills, agents, models, MCP servers) are registered automatically; external AI tools used in the organisation are added manually or discovered from expense, SaaS and network signals. Each entry has a lifecycle and links to assessments, evaluations, incidents and changes; entries are CIs, so incident, change and supplier processes apply.
- Build: `ai_system` CI class; discovery integrations; lifecycle workflow.

**AI-176 · 6C capability tagging and governance templates** — برچسب قابلیت‌های ۶C و قالب‌های حاکمیتی
- P1 · AI: no · Family: Governance · Modules: ai
- Sources: ITIL v5 AI Capability Model (Creation, Curation, Clarification, Cognition, Communication, Coordination; the capability set drives the default governance template).
- What/how: Every skill and agent carries 6C tags; each tag combination maps to a default governance template (required evaluation, human-review level, disclosure, log retention, risk tier) applied at creation; deviations need approval.
- Build: tags on `ai_skill` and `ai_agent`; governance templates.

**AI-177 · AI impact and risk assessment** — ارزیابی اثر و ریسک هوش مصنوعی
- P1 · AI: no · Family: Governance · Modules: ai, security
- Sources: ITIL v5 (assessment questionnaire per use case), ISO/IEC 42001 (AI impact assessment; Statement of Applicability; Annex A controls), ISO/IEC 23894 (AI risk management), ISO/IEC 42005 (impact assessment; status unverified), EU AI Act (prohibited, high, limited and minimal risk; Digital Omnibus timeline: Art. 50 from 2 Aug 2026, Annex III from 2 Dec 2027), NIST AI RMF 1.0 and NIST AI 600-1, ServiceNow (AI Risk and Compliance; five risk frameworks), COBIT (AI risk scenarios).
- What/how: An assessment per AI system or use case covers affected people, reversibility, transparency, data sensitivity, regulatory class, ethics, required controls, residual risk and approver; it is repeated on material change and feeds the shared risk register and control library (with 42001 Annex A crosswalks).
- Build: `ai_impact_assessment` on the questionnaire engine; risk links.

**AI-178 · AI incidents and problems** — حادثه‌ها و مسائل ناشی از هوش مصنوعی
- P1 · AI: no · Family: Governance · Modules: incident, problem, ai, security
- Sources: ITIL (incident and problem record types for AI failures: harmful output, wrong action, data leakage, bias complaint; severity; containment by disabling the feature; notification duties; root-cause analysis and corrective actions), EU AI Act (serious-incident reporting for high-risk systems).
- What/how: An "AI" incident category with fields for the AI system, run id, harm type and affected users; one-click containment through the kill switch; evidence pulled from traces; problem management for recurring AI failures; a regulatory notification clock where applicable.
- Build: category plus extension table; links to `ai_run`.

**AI-179 · Model cards in knowledge** — شناسنامه مدل‌ها و مهارت‌ها در پایگاه دانش
- P1 · AI: yes (drafting) · Family: Governance · Modules: knowledge, ai
- Sources: ITIL v5 (AI documentation as controlled knowledge: data sources, assumptions, limitations, intended use, failure modes, evaluation results, user guidance), ISO/IEC 42001 (information for interested parties).
- What/how: Model and skill cards are drafted from the register and evaluation data, validated by the owner and kept as controlled articles: purpose, data used, limitations, evaluation results, known failure modes, oversight and how users should check the output. Each AI label links to its card ("about this AI").
- Build: card template; generation from register and evaluation data.

**AI-180 · Workforce-safe AI controls** — کنترل‌های استفاده ایمن از هوش مصنوعی درباره کارکنان
- P1 · AI: no · Family: Governance · Modules: workforce, ai, knowledge
- Sources: standards (EU AI Act Annex III 4(b): AI that allocates work or evaluates workers is high-risk from 2 Dec 2027 — human oversight, logs kept at least six months, prior information to workers; team-level metrics by default; individual AI scoring configured as high-risk with oversight records), ai.md (AutoQA never used for pay decisions without human review), access.md.
- What/how: Any AI that routes work, infers skills or scores agents is flagged high-risk: workers are informed, a person oversees decisions, logs are retained, individual metrics are visible only to the person and their coach or manager for a stated purpose, inferred skills need the person's confirmation, and decisions can be appealed.
- Build: risk-tier flag; worker notices; retention policy.

**AI-181 · AI literacy and guidance** — سواد هوش مصنوعی و راهنمایی کاربران
- P2 · AI: no · Family: Governance · Modules: ai, portal, platform
- Sources: EU AI Act Art. 4 (AI literacy duty since 2 Feb 2025), ITIL v5 (human–AI workforce: competence development and accountability), standards.
- What/how: Short in-app explanations of what each AI feature does and where it fails, role-based micro-training for agents and admins, acknowledgement tracking for staff using AI features, and "how to check this output" tips beside high-impact outputs.
- Build: help content; attestation campaigns (KB-026).

#### 12. Domain-specific AI

**AI-182 · Vulnerability prioritisation and solution suggestion** — اولویت‌بندی آسیب‌پذیری و پیشنهاد راه‌حل
- P2 · AI: yes · Family: Domain · Modules: security, itam, change
- Sources: ServiceNow (Now Assist for Vulnerability Response: summarisation, preferred-solution suggestions, remediation-status analysis, CISA vulnerability analysis), BMC (Vulnerability Classification), Ivanti (exposure management), standards (EPSS, KEV, exposure and CI criticality), ai.md (deterministic scoring; grouping by solution; LLM explanation citing the advisory).
- What/how: risk = CVSS × f(EPSS) × KEV boost × asset criticality × exposure × (1 − compensating controls). Vulnerable items are grouped into remediation tasks by solution and owner; advisories are summarised with citations; remediation status is analysed against SLA by severity, group and CI.
- Build: deterministic scoring; summarisation skill.

**AI-183 · Regulatory change mapping and control rationalisation** — نگاشت تغییرات مقرراتی و یکپارچه‌سازی کنترل‌ها
- P2 · AI: yes · Family: Domain · Modules: security, continuity, supplier
- Sources: ServiceNow (IRM: regulatory alert summarisation; affected citations, control objectives, controls and policies; generated regulatory action plans; control objective rationalisation and common objectives; issue summarisation and remediation agent), standards (cross-framework control-mapping suggestions).
- What/how: Regulation clauses and internal controls are embedded; for each changed clause the affected controls and policies are retrieved, impact is classified (none, minor, material) with a rationale and an action plan is drafted for approval. Similar control objectives (cosine ≥ 0.88) are clustered into a proposed common objective with a crosswalk; nothing is deleted.
- Build: requirement-library embeddings; skills.

**AI-184 · Questionnaire auto-answering and evidence checks** — پاسخ خودکار به پرسش‌نامه‌ها و بررسی کفایت شواهد
- P2 · AI: yes · Family: Domain · Modules: security, supplier
- Sources: ServiceNow (TPRM questionnaire response generation; issues proposed from supplier answers and created only after confirmation; risk summaries with role masking), standards (security-questionnaire auto-answering from the control library with citations; evidence-sufficiency checks), ai.md (meets / partial / gap / needs-evidence labels).
- What/how: Drafts answers to customer and regulator security questionnaires from the control library with citations; checks whether uploaded evidence satisfies a control test; labels supplier answers as meets, partial, gap or needs evidence and proposes issues for confirmation.
- Build: retrieval over the control library; labelling skill; proposals.

**AI-185 · Risk identification from free text** — شناسایی ریسک از متن‌های آزاد
- P2 · AI: yes · Family: Domain · Modules: security, project, continuity, supplier
- Sources: ServiceNow (Risk Identification Agent; Suggest Potential Risks; Issue Submission Agent), standards (risk-scenario drafting from incidents and threat intelligence; RAID extraction), ITIL (risk identification from free text).
- What/how: Scans incidents, problems, project notes and threat feeds for emerging risks and drafts risk scenarios (asset, threat, event, consequence) with likelihood and impact suggestions, as drafts for risk owners.
- Build: extraction skill; draft risks in the shared risk register.

**AI-186 · Regulatory reporting assistant** — دستیار گزارش‌دهی به نهادهای ناظر
- P2 · AI: yes · Family: Domain · Modules: incident, security, continuity
- Sources: standards (a regulatory classification assistant pre-fills EU DORA, NIS2 and GDPR criteria from incident data for human confirmation; regulatory clock engine).
- What/how: Pre-fills classification criteria and report drafts for the regimes a tenant configures (EU regimes for international organisations; local sector-regulator and national CERT reporting templates) from incident data, computes deadlines from the "aware" and "classified" timestamps, and leaves confirmation and submission to a person.
- Build: regime templates; clock engine; drafting skill.

**AI-187 · Supplier risk signals and performance narrative** — نشانه‌های ریسک تأمین‌کننده و روایت عملکرد
- P2 · AI: yes · Family: Domain · Modules: supplier, financial
- Sources: standards (supplier risk-signal monitoring: breach news, sanctions, financial distress; performance anomaly detection across providers; contract clause gap checks against DORA Art. 30 and GDPR Art. 28), ITIL (renewal-risk alerts; supplier performance insights), ai.md (supplier scorecard narrative from deterministic numbers).
- What/how: Monitors permitted news and lists for supplier risk signals, detects SLA and performance anomalies across providers (SIAM), writes the quarterly scorecard narrative from computed metrics, and highlights renewal risks and clause gaps.
- Build: opt-in signal connectors; scorecard job; narrative skill.

**AI-188 · Field service AI** — هوش مصنوعی خدمات میدانی
- P2 · AI: yes · Family: Domain · Modules: field_service
- Sources: ServiceNow (work order summarisation; knowledge generation after task closure; work order creation from text or images; scheduling agents; Schedule Optimization solver), BMC (intelligent work assignment by proximity, availability and skills), ITIL (schedule optimisation, duration and travel prediction, parts forecasting, predictive maintenance, image recognition, guided troubleshooting).
- What/how: Creates work orders from text or photos, predicts duration and parts, optimises schedules and routes with a solver (aware of local traffic patterns and Iranian holidays), guides technicians with knowledge and history, recognises asset labels and damage in photos, and drafts closure summaries and articles.
- Build: solver service; skills; mobile integration.

**AI-189 · DevOps AI** — هوش مصنوعی DevOps
- P2 · AI: yes · Family: Domain · Modules: devops, change, release, incident
- Sources: ITIL v5 (code review assistance, test generation and failure triage, defect prediction, PR and change summarisation, deployment-risk scoring, automated rollback decisions, suspect-commit identification, postmortem drafting), BMC (code-aware Deep RCA; remediation code wizard), ServiceNow (Impact Code Fix Agent), Dynatrace (Developer agent), Atlassian (Jira Delivery Agent).
- What/how: Summarises pull requests and pipeline runs on change records, scores deployment risk from pipeline signals, identifies suspect commits for incidents after deployments, triages test failures and drafts postmortems. Generating product code is out of scope (see exclusions).
- Build: CI/CD connectors; skills.

**AI-190 · AutoQA and coaching** — ارزیابی خودکار کیفیت و مربیگری
- P2 · AI: yes · Family: Domain · Modules: workforce, csm, security, change
- Sources: Zendesk (QA / AutoQA scores conversations and selects those worth reviewing), ServiceNow (security incident quality assessment; Change Quality Assessor), standards (coaching suggestions from article-quality samples), ai.md (rubric scored 0–2 per criterion with quotes; calibrated against human graders with Cohen's κ; never used for pay decisions without human review).
- What/how: An LLM judge scores replies and records with a rubric (greeting, empathy, correctness against the knowledge base, policy compliance, resolution confirmation) with quoted evidence, selects conversations for human review and suggests coaching; individual results are visible only to the person and their coach (AI-180).
- Build: rubric skill; sampling; restricted views.

#### AI capability map by module

Bold = P0. **Cross-cutting** features apply to every module through the platform: **AI-001**, **AI-002**, **AI-003**, **AI-004**, **AI-005**, **AI-006**, **AI-008**, **AI-009**, **AI-010**, **AI-011**, **AI-012**, **AI-013**, **AI-014**, **AI-016**, **AI-018**, **AI-019**, **AI-021**, **AI-027**, **AI-071**, **AI-072**, **AI-074**, **AI-075**, **AI-076**, AI-077, AI-078, **AI-079**, AI-095, **AI-111**, **AI-112**, AI-114, AI-117, AI-119, **AI-122**, AI-138, AI-146, AI-149, **AI-154**, **AI-156**, **AI-157**, **AI-158**, **AI-159**, **AI-160**, **AI-161**, **AI-164**, **AI-165**, **AI-169**.

| Module | Module-specific AI features (in addition to the cross-cutting ones) |
|---|---|
| `platform` | AI-040, **AI-072**, **AI-079**, AI-087, AI-117, AI-139, AI-140, AI-141, AI-142, AI-143, AI-149, AI-150, AI-151, AI-152, AI-181 |
| `incident` | AI-017, AI-022, **AI-023**, AI-024, **AI-025**, **AI-026**, AI-028, AI-029, AI-030, AI-031, AI-038, AI-039, AI-040, **AI-041**, **AI-042**, AI-043, AI-044, AI-045, AI-047, AI-048, AI-049, AI-050, AI-051, AI-055, **AI-058**, **AI-059**, **AI-061**, **AI-062**, AI-065, AI-066, **AI-067**, **AI-071**, AI-077, AI-080, AI-081, AI-082, AI-084, AI-085, AI-091, AI-093, AI-098, AI-100, AI-101, AI-102, AI-103, AI-113, AI-124, AI-126, AI-178, AI-186, AI-189 |
| `problem` | AI-017, **AI-023**, **AI-026**, AI-029, AI-031, **AI-041**, **AI-042**, AI-044, AI-045, AI-047, AI-050, AI-051, **AI-071**, AI-081, AI-085, AI-101, AI-109, AI-124, AI-178 |
| `change` | AI-017, **AI-023**, AI-032, AI-033, AI-038, **AI-041**, **AI-042**, AI-046, AI-047, AI-050, AI-051, **AI-062**, **AI-071**, AI-085, AI-086, AI-087, AI-102, AI-124, AI-126, AI-129, AI-144, AI-174, AI-182, AI-189, AI-190 |
| `release` | **AI-023**, AI-032, AI-033, AI-034, AI-046, AI-050, AI-053, **AI-071**, AI-086, AI-189 |
| `request` | **AI-023**, **AI-025**, **AI-026**, AI-028, AI-037, AI-038, AI-039, AI-040, **AI-041**, **AI-042**, AI-043, AI-048, AI-049, AI-050, AI-054, AI-055, **AI-058**, **AI-059**, **AI-060**, **AI-062**, AI-065, AI-068, **AI-071**, AI-077, AI-080, AI-081, AI-082, AI-083, AI-084, AI-087, AI-088, AI-089, AI-090, AI-094, AI-113, AI-120, AI-121, AI-124, AI-140 |
| `knowledge` | **AI-010**, AI-015, AI-022, AI-028, AI-051, **AI-058**, AI-068, AI-073, **AI-122**, AI-125, AI-149, **AI-156**, AI-179, AI-180; knowledge-module AI features: KB-012, KB-017, KB-023, KB-032–KB-034, KB-036, KB-037, KB-039, KB-041, KB-045–KB-047, KB-050–KB-053, KB-055, KB-057, KB-060–KB-062, KB-065–KB-082 |
| `cmdb` | AI-017, **AI-023**, **AI-071**, AI-102, AI-115, AI-126, AI-127, AI-128, AI-129, AI-130, AI-131, AI-132, AI-136, AI-143, AI-175 |
| `itam` | **AI-023**, AI-039, **AI-071**, AI-083, AI-088, AI-090, AI-094, AI-105, AI-123, AI-126, AI-127, AI-130, AI-131, AI-132, AI-133, AI-134, AI-135, AI-136, AI-137, AI-143, AI-182 |
| `slm` | AI-035, AI-048, AI-049, AI-054, AI-106, AI-109, AI-113, AI-115, AI-116, AI-118, AI-141, AI-144 |
| `service_portfolio` | **AI-041**, AI-092, AI-120, AI-121, AI-140 |
| `event` | AI-017, AI-022, AI-024, AI-029, AI-030, AI-031, **AI-042**, AI-044, AI-047, **AI-067**, AI-077, AI-093, AI-098, AI-099, AI-100, AI-101, AI-102, AI-103, AI-104, AI-105, AI-106, AI-107, AI-108, AI-110, AI-115, AI-129 |
| `continuity` | AI-030, AI-035, AI-037, AI-093, AI-102, AI-103, AI-104, AI-105, AI-106, AI-109, AI-144, AI-183, AI-185, AI-186 |
| `security` | **AI-023**, AI-029, AI-031, AI-037, **AI-041**, **AI-071**, AI-080, AI-091, **AI-122**, AI-123, AI-136, AI-147, AI-148, AI-149, **AI-163**, **AI-167**, **AI-171**, AI-175, AI-177, AI-178, AI-182, AI-183, AI-184, AI-185, AI-186, AI-190 |
| `supplier` | **AI-023**, AI-035, AI-037, **AI-122**, AI-123, AI-175, AI-183, AI-184, AI-185, AI-187 |
| `financial` | AI-035, AI-087, AI-090, AI-104, AI-116, AI-123, AI-131, AI-133, AI-134, **AI-168**, AI-187 |
| `project` | **AI-023**, AI-036, AI-038, AI-092, AI-185 |
| `workforce` | AI-024, AI-048, AI-050, AI-051, AI-052, AI-055, **AI-063**, AI-110, AI-116, AI-141, AI-180, AI-190 |
| `portal` | AI-015, AI-022, AI-024, AI-028, AI-030, AI-034, AI-039, AI-043, AI-049, AI-052, AI-054, **AI-058**, **AI-059**, **AI-060**, **AI-061**, **AI-062**, **AI-063**, AI-064, AI-065, AI-066, **AI-067**, AI-068, AI-069, AI-070, AI-073, AI-082, AI-118, AI-125, AI-144, AI-152, AI-162, AI-181 |
| `esm` | **AI-023**, **AI-026**, AI-028, AI-036, AI-037, **AI-041**, AI-049, **AI-058**, **AI-059**, AI-064, AI-068, **AI-071**, AI-082, AI-088, **AI-122**, AI-123, AI-149, AI-162 |
| `csm` | AI-022, **AI-023**, AI-024, **AI-025**, **AI-026**, AI-028, AI-035, **AI-041**, **AI-042**, AI-049, AI-057, **AI-063**, AI-064, AI-066, AI-069, **AI-071**, AI-080, AI-084, AI-118, AI-124, AI-144, AI-162, AI-190 |
| `analytics` | AI-035, AI-045, AI-052, AI-073, AI-104, **AI-111**, **AI-112**, AI-113, AI-114, AI-115, AI-116, AI-118, AI-119, AI-120, AI-172, AI-173 |
| `access` | AI-083, AI-088, AI-089, AI-135, AI-145, AI-146, AI-147, AI-148, **AI-154**, **AI-155**, **AI-156**, **AI-171** |
| `integration` | AI-015, AI-064, AI-083, AI-094, AI-095, AI-096, AI-097, AI-108 |
| `admin` | **AI-001**, AI-007, AI-020, AI-056, AI-138, AI-139, AI-140, AI-141, AI-142, AI-143, AI-145, AI-150, AI-151, AI-152, **AI-153**, **AI-155**, **AI-163**, **AI-166**, **AI-167**, **AI-168**, AI-170 |
| `devops` | AI-033, AI-034, AI-046, AI-053, AI-189 |
| `field_service` | **AI-023**, **AI-025**, AI-039, AI-137, AI-188 |
| `ai` | **AI-001**, AI-007, AI-020, AI-056, AI-095, AI-096, AI-097, AI-120, AI-125, AI-139, AI-148, **AI-153**, **AI-154**, **AI-155**, **AI-156**, **AI-157**, **AI-160**, **AI-161**, AI-162, **AI-163**, **AI-166**, **AI-167**, **AI-168**, AI-170, **AI-171**, AI-172, AI-173, AI-174, AI-175, AI-176, AI-177, AI-178, AI-179, AI-180, AI-181 |


### Data model

**Record tables** (every table carries `tenant_id`; tables that hold or reference business data also carry `domain_id, workspace_id` and inherit or store `acl_keys`):

| Table | Prefix | Key fields | States (→ category) | Relationships |
|---|---|---|---|---|
| `ai_provider` | — | kind {openai_compat, anthropic, gemini, local}, name, base_url, secret_ref, region, models[] {id, tiers, capabilities {tools, json, vision, embeddings, rerank, stt, tts, context_len}, certified_for[]}, data_policy {zero_retention, no_training}, scope (tenant/domain), health | active → active; degraded → waiting; disabled → closed | tier maps, invocations |
| `ai_model_tier_map` | — | tier {small, large, embedding, rerank, vision, stt, tts}, provider_id, model, pinned_version, fallback_chain[], scope_type, scope_id | — | provider |
| `ai_skill` | — | key, module, record_type, family, six_c[], name_fa, name_en, input_spec, prompt_version_id, model_tier, output_schema, target {field, note, panel, card, notification}, triggers[], auto_apply_policy, thresholds {show, prefill, auto}, pii_policy, languages[], ootb, cloned_from, owner_group_id, version | draft → new; testing → active; active → active; retired → closed | prompt versions, invocations, eval runs |
| `ai_prompt_version` | — | skill_id or agent_id, text, variables, created_by, eval_run_id, change_id | draft → new; testing → waiting; active → active; retired → closed | skill/agent, change record |
| `ai_agent` | `AGT-` | name, role, goal, instructions, knowledge_scope[], tool_ids[], sub_agent_ids[], triggers[], run_as {caller, ai_user}, ai_principal_id, role_mask[], autonomy {shadow, supervised, autonomous}, autonomy_by_scope, budgets, owner_group_id, version, six_c[], risk_tier, ai_system_id | draft → new; testing → active; published → active; suspended → waiting; retired → closed | tools, runs, register entry |
| `ai_tool` | — | key, kind {record_action, flow, catalog_item, connector, mcp, http, script}, json_schema, required_permission, risk {read, write_low, write_high, destructive, external_send}, policy {auto, confirm, approval, blocked}, allowed_group_ids[], mcp_server_id | unmapped → new; enabled → active; blocked → canceled | agents, tool calls |
| `ai_run` | `AIR-` | agent_id or skill_id, trigger, run_as_principal_id, on_behalf_of_user_id, record_type, record_id, goal, plan_json (versioned), autonomy_mode, budgets, tokens, cost, latency_ms, model, prompt_version_id, acl_fingerprint, outcome {accepted, edited, rejected, closed_by_ai}, closed_by_ai | queued → new; running → active; waiting_approval, waiting_input, paused → waiting; completed → closed; failed → closed; cancelled, killed → canceled | tool calls, proposals, record, approvals |
| `ai_tool_call` | — | run_id, seq, tool_id, args_redacted, result_ref, risk, policy_mode, decision {auto, approved, rejected, blocked}, approver_id, idempotency_key, status, error | pending → new; executing → active; awaiting_approval → waiting; done → closed; failed → closed; blocked → canceled | run, tool |
| `ai_proposal` | — | run_id or invocation_id, target_type, target_id, action, diff_json, justification, source_refs[], risk, required_approver_role, expires_at, executed_change_ref | proposed → new; awaiting_approval → waiting; approved → active; executed → closed; failed → closed; rejected, expired → canceled | approval record, target record |
| `ai_invocation` | — | skill_id, user_id, surface, record_type, record_id, input_hash, acl_fingerprint, provider, model, tokens_in, tokens_out, cost, latency_ms, status, output_ref, citations[], guard_flags[], confidence, accepted, edit_distance | — (log) | skill, record, feedback |
| `ai_suggestion` | — | record_type, record_id, field, value, confidence, source {ml, llm, rule}, explanation, invocation_id | proposed → new; accepted, edited, auto_applied → closed; rejected, expired → canceled | record, invocation |
| `ai_conversation` | `CHT-` | user_id, persona {requester, agent, external, guest}, channel, language, started_at, ended_at, tier_answered, deflected, linked_record, csat, summary, retention_until | active → active; waiting_user → waiting; resolved → resolved; handed_off, abandoned → closed | messages, linked ticket, feedback |
| `ai_message` | — | conversation_id, role, content_redacted, citations[], tool_call_ids[], feedback, created_at | — | conversation |
| `ai_memory` | — | user_id, key, value, source, expires_at | — | user |
| `ai_feedback` | — | target_type, target_id, user_id, rating {up, down}, reasons[], comment, routed_to_group_id | new → new; triaged → active; done → closed | invocation, message, run |
| `rag_source` | — | kind {kb, snippets, documents, catalog, records, connector, help, glossary}, config, chunking {size, overlap, small_to_big}, ai_policy, freshness_window, index_version_id | active, paused, rebuilding | chunks, connector |
| `rag_chunk` | — | source_kind, record_type, record_id, version, field_group, page, language, text, tsv, embedding, parent_chunk_id, title_path, acl_keys[], classification, ai_extract_allowed, persona_mask, valid_to, stale, updated_at | — | source record or document version |
| `rag_index_version` | — | embedding_model, dims, created_at | building → active; active; retired → closed | chunks |
| `ml_model` | — | key, kind {classification, similarity, clustering, survival, forecast, anomaly}, record_type, inputs[], output, filter, schedule, version, metrics {precision, coverage, per_class}, thresholds | training → active; candidate → waiting; active → active; retired → closed | suggestions |
| `ai_cluster` | — | kind {mi_candidate, problem_candidate, kb_gap, alert_group, feedback_theme, automation_opportunity}, member_refs[], centroid, label, score, trend, owner_module | open → new; reviewing → active; accepted → resolved; dismissed → canceled | members, created record |
| `insight_card` | — | metric_id, type {majority, outliers, trend_change, longest_run, recent_change, overall_trend, anomaly, forecast}, period, dimension, effect_size, narrative, drivers_json, criticality, scope_keys | new → new; seen → active; dismissed → canceled | metric, dashboard |
| `nl_query_log` | — | user_id, question, interpreted_ast, compiled_hash, report_definition_id, feedback | — | report definition |
| `ai_eval_dataset` / `ai_eval_item` / `ai_eval_run` | `EVR-` (run) | dataset(target, source {manual, logs, synthetic, csv, feedback}, language); item(input, expected, expected_sources); run(target_version, model, metrics_json, verdict {excellent, good, moderate, poor}, passed) | queued → new; running → active; completed → closed; failed → closed | skill/agent version, change record |
| `ai_budget` / `ai_usage` | — | budget(scope_type, scope_id, period, limits {tokens, cost, sessions, resolutions}, alert_at[], action {warn, degrade, stop}); usage(date, scope, provider, model, skill_or_agent, tokens, cost, sessions, resolutions, gpu_seconds) | — | scope |
| `ai_policy` | — | scope (skill, agent, tool, action_type), condition_ast, mode {autonomous, act_then_notify, propose_approve, advise_only, prohibited}, approver_role, rollback_required, priority | active, retired | tools, agents |
| `ai_channel_policy` | — | scope_type (tenant, domain, workspace, record_type, kb_base, classification), scope_id, channel, persona, may_read, may_extract | active, retired | chunks, gateway |
| `ai_system` (CI class) | `AIS-` | name, owner_id, owner_group_id, purpose, six_c[], data_sources, data_classification, provider, model, version, autonomy_level, risk_tier, eu_ai_act_class, regulations[], oversight_design, last_eval_run_id, model_card_article_id, shadow (bool) | proposed → new; assessed, approved, pilot → active; production → active; retired → closed; rejected → canceled | skills/agents, assessments, incidents, changes, supplier |
| `ai_impact_assessment` | `AIA-` | ai_system_id, answers_json, risk_class, controls[], residual_risk, approver_id, next_review_at | draft → new; in_review → waiting; approved → closed; rejected → canceled; expired → waiting | AI system, risks, controls |
| `mcp_server` | — | direction {inbound_client, outbound_server}, name, url, auth_kind, lifecycle, steward_id, allowed_tool_keys[] | in_review → new; assess → waiting; approved, active → active; paused → waiting; deprecated → closed | tools |
| `mcp_token` | — | user_id, client_name, scopes[], read_only, created_at, last_used_at, revoked_at | active, revoked | user |
| `ai_incident_detail` | — | incident_id, ai_system_id, ai_run_id, harm_type {harmful_output, wrong_action, data_leakage, bias, other}, affected_count | (follows the incident) | incident, run, AI system |

**Numbering prefixes:** `AGT-` agent, `AIR-` AI run, `CHT-` conversation, `EVR-` evaluation run, `AIS-` AI system, `AIA-` impact assessment. Suggestions, invocations, chunks and tool calls are internal ids.

**Access-scoping fields:**
- *Own*: `ai_conversation.user_id`, `ai_run.on_behalf_of_user_id`, `ai_feedback.user_id`, `ai_memory.user_id`, `mcp_token.user_id`, personal document collections.
- *Record-inherited*: `ai_invocation`, `ai_run`, `ai_suggestion` and `ai_proposal` reference a record (`record_type, record_id`) and are visible only to subjects who can read that record (participant, group, unit, company keys of the record); run details additionally need the `ai_log.read` permission in that scope.
- *Group*: `ai_agent.owner_group_id`, `ai_skill.owner_group_id` (builders), approver groups on proposals, routing of feedback.
- *Domain and workspace*: `domain_id` and `workspace_id` on runs, conversations, chunks, budgets, policies and providers (per-domain AI policy in MSP mode; secure workspaces get their own index partitions and assistants).
- *Classification and AI channel*: `rag_chunk.classification`, `ai_extract_allowed`, `persona_mask`, `ai_channel_policy`; logs about restricted records carry the record's restriction keys.
- *Admin scope*: providers, tier maps, budgets, policies and the AI register are visible to AI administrators at tenant or domain scope; AI stewards approve MCP servers.

### KPIs

| KPI | Formula | Notes |
|---|---|---|
| Suggestion acceptance rate | accepted (as-is + edited) ÷ suggestions shown | ITIL v5; split as-is vs edited |
| Normalised edit distance | avg(edit_distance(draft, final) ÷ length(final)) | main quality signal for drafts |
| Classification precision / coverage | predictions equal to the final value ÷ predictions; records with a prediction ÷ records | per class, 30-day (ServiceNow PI) |
| Auto-apply precision | auto-applied values unchanged after 7 days ÷ auto-applied values | gate for raising thresholds |
| Override rate | AI-applied outputs reversed by people ÷ AI-applied outputs | ITIL v5 |
| Auto-resolution rate | records closed by AI ÷ records closed | "Closed by AI" attribution |
| Containment rate | assistant conversations ended without a human ÷ conversations | per channel |
| Deflection with satisfaction | deflected sessions rated ≥ 4/5 ÷ self-service sessions | ITIL v5 |
| Hand-off quality | handoffs where the agent did not re-ask collected fields ÷ handoffs | detected from the first agent reply |
| AI-resolution reopen rate | AI-resolved records reopened within 7 days ÷ AI-resolved records | autonomy demotion trigger |
| CSAT AI vs human | mean CSAT (AI-resolved) − mean CSAT (human-resolved) | same categories |
| Groundedness | sampled answer sentences supported by their citations ÷ sampled sentences | LLM judge calibrated by Cohen's κ |
| Citation precision | citations that support their sentence ÷ citations | — |
| Retrieval quality | recall@k, MRR, nDCG on golden sets | per source and language |
| Abstention rate / correct abstention | abstained answers ÷ questions; abstentions judged correct ÷ abstentions | high abstention feeds the gap engine |
| Hallucination reports | user-reported wrong answers per 1,000 answers | feedback reasons |
| Calibration error (ECE) | Σ_bins (n_bin ÷ N) × abs(accuracy_bin − confidence_bin) | per model and skill |
| Agent task completeness / tool-call accuracy | judge scores per run; tool sub-metrics combined with AND | ServiceNow Agentic Evaluations |
| Plan acceptance rate | supervised plans executed without edits ÷ plans | promotion gate ≥ 95% over the last 50 |
| MTTR uplift | MTTR(non-assisted) − MTTR(AI-assisted), same category and priority | BMC value dashboard style |
| Cost per AI-assisted resolution | AI cost ÷ AI-assisted resolutions; tokens per resolution | per skill and provider |
| Budget utilisation | spend ÷ budget per scope | alerts at 80% and 100% |
| Latency | p50/p95 time to first token and total time | per surface |
| Fallback rate | calls served by a fallback model ÷ calls | provider health |
| Guardrail activity | injection detections per 1,000 untrusted inputs; blocked outputs; masked entities per call | Guardian-style |
| Permission-leak test pass rate | passed probes ÷ probes | must be 100% |
| Time to disable | seconds from kill-switch action to no further AI activity | drill result |
| Governance coverage | AI systems with owner and risk tier ÷ AI systems; with impact assessment; with evaluation in the last 90 days; with a model card | ITIL v5, ISO/IEC 42001 |
| AI incidents | AI incidents per month; mean time to contain | — |
| Adoption / engagement | users who used an AI feature ÷ eligible users; users active ≥ 4 of the last 6 weeks ÷ adopters | InvGate split |
| Fairness gap | max difference across groups in routing outcome, answer acceptance or resolution time | ITIL v5 bias monitoring |
| Input drift | population stability index of topic and language mix vs the training window | triggers retraining |
| Prediction quality | Brier score and AUC (change risk, breach); MAPE and bias (forecasts) | per tenant model |

### Beyond the market

- **Sovereign by design.** Every AI capability, embeddings, re-ranking and Persian speech included, can run on the tenant's own hardware through OpenAI-compatible local servers, with automatic local fallback when cloud providers or international links are unavailable. No leading vendor offers a complete local stack; BMC's self-hosted models are the closest.
- **Classification-based model routing.** Beyond choosing a model per skill, the gateway routes by data classification: confidential and personal content only to local models, public content to any approved provider, in the same conversation.
- **Permission-exact AI with proof.** `user ∩ agent ∩ channel`, early and late binding, citation re-checks and canary leak tests in CI and in production, shown on a leak dashboard. No vendor publishes leak testing.
- **Every module is AI-operable on day one.** Because tools are generated from the metadata engine, any new record type immediately supports AI summaries, natural-language queries and the AI operator, with proposals, diff preview and undo.
- **Offline AI in the Windows app.** A small local model works over the permission-exact device replica; AI proposals made offline queue and are re-validated at sync.
- **Persian-native intelligence.** Normalisation, Finglish, formal administrative register, Persian sentiment nuance (polite wording that hides frustration), Persian evaluation sets for every skill, and Persian speech for messenger voice notes and phone calls (Asterisk/Issabel).
- **Jalali-aware prediction.** Natural-language dates ("دو هفته مانده به نوروز"), forecasts, SLA breach models and change windows that know the Iranian working week, official solar and shifting lunar holidays and seasonal patterns such as Nowruz and Ramadan.
- **Messenger-native agents.** Requests, answers, status, approvals and AI disclosure inside Bale, Eitaa, Telegram and Rubika, plus SMS gateways, with account linking and one-time-code step-up for sensitive actions.
- **Numbers never hallucinated.** Every narrative, insight and report summary passes a number validator against the computed facts.
- **AI managed as a service.** AI systems are CIs with owners, changes, incidents, problems, evaluations, impact assessments and model cards, aligned out of the box with ISO/IEC 42001, the EU AI Act and NIST AI RMF and adaptable to local rules.
- **Gaps the market leaves open:** per-ticket SLA breach probability with explanations, ML-proposed CMDB relationships, contradiction detection across policies and circulars, and AI that drafts and reads Iranian official correspondence (letter number, Jalali date, issuing unit).
- **Cost control for local GPUs.** GPU time metered like tokens; budgets degrade to the small tier instead of failing; usage shown per department.

## Deliberately excluded

| Excluded capability (tool) | Reason |
|---|---|
| Vendor-hosted proprietary models (Now LLM, Zia LLM, fine-tuned HelixGPT) | We do not host or train foundation models; tenants bring their own cloud or local models. Classic per-tenant ML stays (AI-056). |
| Cross-tenant training or sharing customer data to improve shared models (e.g. contributing to a vendor content service) | Privacy and data sovereignty; training happens only inside one tenant. |
| Reselling AI as credits, assists, sessions or per-resolution fees (Rovo credits, Now Assist assists, Freddy sessions, Zendesk outcome pricing) | Tenants pay their own providers; we provide metering, budgets and quotas only (AI-168). |
| Product-code generation agents (Jira Coding Agent, Autonomous Engineer writing product code, PRs in customer repositories) | Software engineering tooling, not service management. Script and configuration generation on our platform remains (AI-142, AI-151). |
| General productivity agents unrelated to service management (OKR Generator, Meeting Insights, Decision Director, Theme Analyzer, sales Customer Insights, User Manual Writer) | Outside ITSM/ESM scope; the general assistant can still help with ad-hoc text. |
| HR talent agents (interview scheduling, compensation planning, recruiting marketplaces) | Belong to HR suites; ESM covers HR case and request handling, plus onboarding journeys (AI-088). |
| Static code analysis of linked repositories inside change risk (Ops Expert) | Outside ITSM scope; pipeline and deployment signals are used instead (AI-046, AI-189). |
| Unconstrained computer-use agents with broad desktop control | Security risk; only sandboxed, signed and consented actions are kept (AI-094). |
| Automatic publication of AI-written external knowledge and automatic sending of AI replies outside approved autonomous scopes | Governance: human review by design (AI-159, KB-066); only promoted autonomous agents act within approved request types. |
| Emotion recognition from employees' voice or face; social scoring; AI scores used for pay or discipline | Prohibited or high-risk under the EU AI Act and unethical; text sentiment of service conversations stays (AI-049, AI-180). |
| Voice cloning or synthetic voices of real staff | Misuse and impersonation risk. |
| MCP token passthrough and unauthenticated agent-to-agent calls | Confused-deputy risk; the MCP authorization specification forbids passthrough (AI-095–AI-097). |
| Gamified knowledge leaderboards and goals on activity counts | KCS warns against goals on activity metrics; we report outcome measures (KB-056). |
| Public web grounding enabled by default (article generation from public sources, web-sourced resolution steps) | Accuracy and sovereignty; available only as an explicit tenant opt-in, never in sovereign mode (KB-068). |
| Knowledge that depends on a separately licensed wiki (JSM's Confluence model) | Our knowledge base is native; external wikis are connectors (AI-015). |
| KCS licence training and exam delivery (LMS) | We track licences and coaching (KB-024); course delivery belongs to learning platforms. |
| Superseded or deprecated vendor features: ServiceNow PI regression framework, Automation Discovery, ITSM PI Workbench; Zendesk Content Cues; IBM Watson-based legacy virtual agents; Freshservice legacy virtual agent | Replaced by AI-048/AI-116 (forecasting and survival models), AI-120 (opportunity discovery), AI-056 (model lifecycle), KB-072/KB-073 (gaps, duplicates) and AI-058 (assistant). |

## Engine requirements

What the shared platform engine must provide for these two modules:

1. **Versioned documents** — stable id plus version rows, draft and published pointers swapped atomically, diff, restore, translations bound to master versions, block references.
2. **Audience engine** — can/cannot read/contribute/request/invoke bindings with deny-wins and subtree semantics, compiled into access keys; explain, view-as and who-can-see diagnostics.
3. **State machines, approvals and SoD** — configurable lifecycles per knowledge base, approval modes (all/any/majority), author ≠ publisher option, scheduled transitions, approvals from e-mail and messengers.
4. **Planned-interval engine on the Jalali calendar** — review dates, routines, attestation campaigns and reminders with Iranian working days and holidays.
5. **Persian-aware search** — full-text index with Persian normalisation, stemming, synonyms, typo tolerance, facets and highlights; access-key pre-filter; search event logging.
6. **Vector store and hybrid retrieval** — pgvector (HNSW) chunks with access keys, classification, field groups, persona mask and page refs; BM25 + kNN with reciprocal rank fusion; re-ranking; small-to-big; index versions and background re-embedding.
7. **Ingestion pipeline** — file parsing (PDF, DOCX, XLSX, PPTX, HTML, MD, TXT, images), Persian/English OCR, structure-aware chunking, virus scanning, connectors with delta sync, mirrored ACLs, identity aliases and freshness windows; re-keying of chunks in the same transaction as ACL changes (outbox) and nightly reconciliation.
8. **AI gateway and provider adapters** — OpenAI-compatible, Anthropic, Gemini and local adapters; model tiers; fallback chains; circuit breakers; streaming; JSON-schema output; normalised tool calling with constrained-JSON fallback; capability matrix; sovereign mode; classification-based routing.
9. **Skill registry and context builder** — skills as data with versioned prompts, permission-aware context assembly (row and field masks, persona and domain pinning, rolling summaries), output targets (field, note, panel, card, notification variable) and the suggestion lifecycle.
10. **Agent runtime** — persisted runs with plans and step logs, tool registry generated from metadata plus registered tools, per-call policy evaluation, approvals as normal approval records, resume on events, idempotency keys, budgets, kill switches; jobs in `llm`, `external` and `system` lanes with fair claiming and step deadlines.
11. **Proposal executor** — AI writes executed through the normal mutation path (validation, business rules, transitions, option rules, SoD, audit) with diff preview, bulk sampling, expiry and undo journal.
12. **Guardrails** — reversible PII masking, injection classifier (log → block), taint tracking, output sanitising and safety classifiers, AI-channel policy enforcement in retrieval and tools.
13. **Principal model for AI** — `ai_agent` principals with explicit grants, role masks, on-behalf-of tokens, attribution columns, deny-by-default for new agents and tools.
14. **Telemetry** — knowledge event stream, AI invocation and run logs, traces, metering and budgets, feedback, all queryable by the report engine under the viewer's predicate.
15. **Semantic metric layer** — certified metrics and dimensions, question-to-AST compilation, row-level security and small-cell suppression, report definitions, scheduled delivery with recipient re-checks, insight engine jobs, number validator.
16. **Classic ML service** — per-tenant training and scoring for classification, similarity, clustering, survival, forecasting and anomaly detection (Python/ONNX sidecar or in-database), model registry with precision/coverage metrics, thresholds and holdout-based promotion.
17. **Conversation core and channel adapters** — portal widget, Windows app, mobile web, e-mail, Microsoft Teams, Slack, WhatsApp, Bale, Eitaa, Telegram, Rubika, SMS gateways and telephony (SIP/IVR), with account linking, session metering and per-channel policies.
18. **MCP server and client, A2A** — OAuth 2.1, audience-bound per-user revocable tokens, read-only default, approval lifecycle for external servers, per-tool audit and pause.
19. **Evaluation and leak testing** — datasets, LLM judges, regression gates in CI, canary records with markers and persona probes.
20. **Offline replica** — sync of permitted articles, snippets, documents and chunks to the Windows app; local index and optional local model; offline proposals re-validated at sync.
21. **Audit** — append-only, hash-chained logs for AI actions and privileged operations; provenance fields on every AI-created or AI-modified record.
22. **Text services** — Persian normalisation and tokenisation, Finglish transliteration, language detection, Jalali date parsing, glossary-based query expansion, translation abstraction (LLM, MT engine or local).
23. **Rich bidi editor and document viewer** — block-based editor with Markdown, code blocks, embeds, internal sections and accessibility checks; document viewer with page anchors for citations.
24. **Feature flags and kill switches** — hierarchical enablement per tenant, domain, workspace, department and role, checked at every AI step.
25. **Speech services** — streaming Persian STT and TTS behind the same tier router, for voice input, messenger voice notes and phone agents.
