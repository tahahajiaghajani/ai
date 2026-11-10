# ITSM reporting/analytics/KPI catalog and the UX/UI patterns of the best ITSM tools

*Research snapshot: 2026-11-07. Part A (reporting engines + KPI catalog) is under `## Module: analytics`, and each module's KPIs are in that module's own section. Part B (UX/UI patterns) is under platform, portal, incident, change, cmdb, event, workforce, admin and ai. Tool tags: [SN] ServiceNow, [JSM] Jira Service Management / Atlassian, [FS] Freshservice, [BMC] BMC Helix, [ME] ManageEngine ServiceDesk Plus / Analytics Plus, [Halo] Halo (HaloITSM), [ZD] Zendesk. Framework tags: [ITIL 4], [KCS], [DORA], [SRE], [HDI/MetricNet]. Targets are typical industry heuristics, not standards, unless a source is named. "(unverified)" marks facts I could not confirm in a source during this session. Some facts come from the team's sibling research notes on ServiceNow, JSM, BMC/ManageEngine and Freshservice, which were built from the official docs listed under Sources.*

## Overview

**Why this matters.** In every leading tool, analytics and UX are where products differ most. Data models for incident, change and request are now similar everywhere. What differs is: (1) how quickly a manager can answer "are we OK, and why not?" and (2) how much clicking, context switching and typing an agent needs per ticket. Market leaders now pair a governed metric layer (indicators, breakdowns, targets, snapshots) with natural-language and agentic analytics. On the agent side they pair a single-pane record page with AI everywhere: summaries, drafted replies, next-best actions and investigations.

**Positioning and current releases (late 2026).**
- **ServiceNow [SN]** — the deepest analytics stack. *Platform Analytics* combines the former Performance Analytics (indicators, breakdowns, targets, thresholds, snapshots, KPI Signals, Spotlight) with Reporting and Next Experience data visualizations. Australia (GA May 2026) made Platform Analytics required for new analytics content; legacy PA is at end of support. **Brazil** is the current family (GA 5 Nov 2026). Packaging since April 2026: *ITSM Foundation* vs *ITSM Advanced*, and Platform Analytics Advanced and Process Mining sit in Advanced. Now Assist, Moveworks and AI Experience were merged into **ServiceNow Otto**, announced 5 May 2026 at Knowledge 2026. The UI is Next Experience (Unified Navigation, Coral theme default since Zurich, Coral dark mode, keyboard-shortcut modal). The agent workspace is *Service Operations Workspace (SOW)*. The portal is *Employee Center (Pro)* and, from 2026, EmployeeWorks.
- **Atlassian JSM [JSM]** — sold since 7 Oct 2025 as **Service Collection** (JSM + Customer Service Management + Assets + Rovo), in Free, Standard, Premium and Enterprise plans. Reporting has three layers: built-in space reports with up to 20 series each, Jira dashboards, and **Insights** (the 2025–2026 rename of Atlassian Analytics), which has Rovo natural-language questions on Standard and above. Enterprise adds advanced dashboards with Visual SQL, 16 chart types and the Atlassian Data Lake. I found **no native right-to-left (RTL) UI** in Jira Cloud; Marketplace apps and browser extensions fill the gap. Data Center 11.3 LTS is the last self-managed line (EOL timeline to 2029).
- **Freshservice [FS]** — continuous delivery with biannual change notices (May and November). Plans are Starter, Growth, Pro and Enterprise. *Analytics Starter/Basic* gives curated reports only. *Analytics Pro* (Pro and Enterprise) adds custom reports, saved filters, **Ask Freddy** NL widgets and export of all reports. Enterprise adds Freddy AI Insights and XLAs. Freddy AI Copilot is a paid add-on.
- **BMC Helix [BMC]** — release train 26.1 → 26.2 → **26.3.01** (Sep 2026). *BMC Helix Dashboards* is Grafana-based (25.3 moved to Grafana 11.6.1, 26.2 to Grafana Scenes; 26.3 adds Arabic RTL). *HelixGPT Insight Finder* builds dashboards from natural language. *ITSM Insights* adds AI problem clustering. Smart Reporting is legacy.
- **ManageEngine [ME]** — ServiceDesk Plus Cloud (continuous; 3 Nov 2026 update) and On-Prem (build 16030, 4 Nov 2026). It ships 150+ predefined reports, Tabular/Matrix/Summary/Audit/Query reports and dashboards. Advanced analytics come from **Analytics Plus** (on-prem) or **Zoho Analytics** (cloud), with **Ask Zia** natural-language charts.
- **Halo [Halo]** — HaloITSM/HaloPSA/HaloCRM, now marketed as "Halo" (usehalo.com). It has a report builder with charts, unlimited dashboards and scheduled reports with PDF templates. The *Halo AI* add-on covers AI agents, "Platform Intelligence", an Ability Library, agent interoperability, AI report creators, AI summaries and forecasting.
- **Zendesk [ZD]** — reference for agent UX: the contextual Agent Workspace, context panel, side conversations, macros and Copilot auto assist. Its reporting tool is *Explore* (datasets, calculated metrics, dashboards, scheduled delivery; data lags by up to about 2 hours).

## Sources
- https://www.servicenow.com/docs/r/J7UfGStUvhlVOcoqiM3zlQ/Re2PWi1DgtByLKDIdshadA (Performance/Platform Analytics concepts)
- https://www.servicenow.com/docs/r/now-intelligence/performance-analytics/pa-threshold.html ; https://www.servicenow.com/docs/r/J7UfGStUvhlVOcoqiM3zlQ/bHBvdSl~Klob1lLIPbe9gA (breakdown/indicator properties)
- https://www.servicenow.com/docs/r/now-intelligence/data-visualization-type-overview.html ; https://www.servicenow.com/docs/r/J7UfGStUvhlVOcoqiM3zlQ/zep6ydqvsFyy2dsVufiT0w (report types)
- https://www.servicenow.com/docs/r/now-intelligence/exploring-kpi-signals.html ; https://www.servicenow.com/docs/r/now-intelligence/proactive-analytics/proactive-analytics.html
- https://www.servicenow.com/docs/r/now-intelligence/create-spotlight-group.html ; https://www.servicenow.com/docs/r/now-intelligence/setting-up-spotlight.html (Spotlight groups, criteria, audits)
- https://www.servicenow.com/docs/r/delta-zurich-australia/australia-zurich-nowassistinplatformanalytics-release-notes.html ; https://www.servicenow.com/docs/r/zurich/now-intelligence/platform-analytics/exploring-now-assist-explorer.html (AI Data Explorer)
- https://www.servicenow.com/docs/r/accessibility/next-experience-accessibility-features-and-updates.html ; https://www.servicenow.com/docs/r/If4ZEK~2WHMkIrdZtEn~Ig/dRv3MsU8Kto3h9Ea5BAoTw (Next Experience keyboard shortcuts)
- https://www.servicenow.com/docs/r/it-service-management/now-assist-for-it-service-management-itsm/now-assist-itsm-incident-assist-workflow.html ; https://www.servicenow.com/docs/bundle/xanadu-it-service-management/page/product/service-operations-workspace/concept/view-inc-record-info-contextual-sidepanel.html
- https://www.servicenow.com/docs/r/release-notes/available-versions.html ; https://nowben.com/servicenow-brazil-release-key-dates-and-preview-information/
- https://www.servicenow.com/platform/otto.html ; https://www.businesswire.com/news/home/20260505481484/en/ (ServiceNow Otto)
- https://www.servicenow.com/docs/r/iMpltWWdX~aXgRlaoFVPCw/SR2vGp0VNAtHQ8FSTYTp0Q (Employee Center) ; https://www.servicenow.com/community/employee-center-articles/content-experiences-and-publishing/ta-p/2638647
- https://support.atlassian.com/jira-service-management-cloud/docs/what-are-custom-reports/ ; https://www.atlassian.com/software/jira/service-management/product-guide/tips-and-tricks/atlassian-analytics
- https://support.atlassian.com/analytics/docs/analytics-is-now-insights/ ; https://support.atlassian.com/analytics/docs/what-is-the-atlassian-data-lake/ ; .../dashboard-templates-for-service-desk-scorecards/ (from the team's JSM notes)
- https://support.atlassian.com/jira-service-management-cloud/docs/what-is-the-change-calendar/ ; .../what-is-the-incident-command-center-icc/ ; .../what-are-major-incidents/ (from the team's JSM notes)
- https://community.atlassian.com/t5/Jira-Service-Management-articles/More-queues-better-queues-in-Jira-Service-Management/ba-p/2257860
- https://marketplace.atlassian.com/apps/1232310/rtl-for-jira (no native RTL in Jira Cloud)
- https://support.freshservice.com/en/support/solutions/articles/233557-generate-intuitive-reports-using-analytics-pro ; https://support.freshservice.com/en/support/solutions/articles/50000001711-getting-started-with-analytics-basic
- https://support.freshservice.com/support/solutions/articles/50000004791 (new report builder experience) ; https://support.freshservice.com/support/solutions/articles/50000009914-freddy-ai-copilot-reports ; https://support.freshworks.com/support/solutions/articles/50000013930-export-reports-and-widgets
- https://support.freshservice.com/en/support/solutions/articles/50000014337-use-the-copilot-agent-to-resolve-tickets-faster
- https://docs.bmc.com/xwiki/bin/view/Helix-Common-Services/Dashboards-Reports/BMC-Helix-Dashboards/BHD253 ; https://docs.bmc.com/xwiki/bin/view/Service-Management/Employee-Digital-Workplace/BMC-HelixGPT/HelixGPT251/AI-agents-in-BMC-HelixGPT/HelixGPT-Insight-Finder
- https://www.manageengine.com/analytics-plus/help/service-desk-cloud-integration.html ; https://www.manageengine.com/uk/products/service-desk/advanced-analytics.html
- https://halopsa.com/guides/article?kbid=917 (Halo reporting guide, shared KB) ; https://usehalo.com/platform/reporting-analytics ; https://usehalo.com/
- https://kb.help.usepylon.com/articles/1591848191-how-do-i-see-who-else-is-viewing-or-responding-to-a-ticket ; https://community.intercom.com/ideas/feature-request-real-time-agent-presence-indicator-12772 (collision patterns)
- https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace ; https://handbook.gitlab.com/handbook/support/readiness/operations/docs/zendesk/zendesk-explore/overview ; https://www.eesel.ai/blog/zendesk-explore-schedule-report-frequency
- https://cd.foundation/blog/2025/10/16/dora-5-metrics/ ; https://dora.dev/guides/dora-metrics/history/
- https://www.rightstar.com/wp-content/uploads/2023/02/Sample-Service-Desk-Industry-Benchmark-from-MetricNet-v1.pdf ; https://www.brighttalk.com/resource/core/447335/benchmarking-roundup---summary-of-2023-service-and-support-benchmarks-v3_954461.pdf ; https://www.thinkhdi.com/library/supportworld/2017/metric-of-month-first-level-resolution-rate
- https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide/070 (KCS metrics matrix) ; https://www.serviceinnovation.org/kcs-metrics-for-senior-leadership/
- Background knowledge, not re-fetched this session: ITIL 4 practice guides (availability, service level), Google SRE Workbook (error budgets, burn-rate alerts), W3C WCAG 2.2.

## Module: analytics

### Features
**A. Reporting and analytics engines by tool**
- **Indicators (KPIs) as scheduled score series** — An indicator combines an indicator source (a table, database view or Workflow Data Fabric table, plus conditions and a collection frequency) with an aggregate (count, sum, average, min, max, count distinct) and optional extra conditions. Scores can be *automated* (data collector), *manual* (entered by hand) or *formula* (computed from other indicators, e.g. `[[Resolved within SLA]]/[[Resolved]]*100`). Indicators are organised in indicator groups. A "day" is always 24 h; PA never uses business days. [SN]
- **Data collector and snapshots** — Collection jobs query each indicator source once per run, so every indicator on that source shares one point in time. Historical jobs backfill new indicators. Snapshots store the sys_ids of contributing records for the indicator and its first-level breakdowns; second-level snapshots are the intersection. So "which 412 incidents made last March's backlog?" can always be answered. [SN]
- **Breakdowns** — Dimensions such as priority, category or assignment group, of three types: *automated* (breakdown source = a table/view or bucket group with conditions), *manual*, or *external* (JDBC + SQL). Breakdown *mappings* tie a breakdown to an indicator source by a field or by a script (*scripted breakdown*). *Bucket groups* hold ranges (e.g. age buckets). At most two breakdown levels per indicator. Element-list size defaults to 1,000 (`com.snc.pa.scorecards.maxbreakdownelements`, max 10,000). [SN]
- **Time series, targets, thresholds, comments** — Statistical functions over windows (e.g. 7-day running average, 3-month SUM) apply in the hub or widgets. *Targets* are goal values. *Thresholds* define a normal range and trigger alerts and dashboard "threshold events". Users can comment on individual scores. Targets, thresholds and comments are not supported when scores are aggregated over several breakdown elements. Bulk target operations are capped at 100. [SN]
- **Analytics Hub / KPI Details** — Replaces scorecards. One page per indicator shows the current score, change against the previous period, gap to target, trend chart with chart options, breakdown list, contributing records and comments. Forecast lines are offered; the method is unverified. [SN]
- **KPI Signals and proactive insights** — Process-behaviour charts with 3-sigma control limits separate common-cause from special-cause variation. Signals fire on outliers, short runs and long runs; an "anti-signal" confirms a process is stable. KPI Signals is activated per indicator. Insight cards on dashboards show signals, key-contributor events and target/threshold events. [SN] [AI]
- **Spotlight** — Highlights records that would otherwise be overlooked. A *Spotlight group* (main indicator must be automated) defines the records to evaluate and a threshold. *Criteria* are indicator-based or query-based, each with a weight. A record's score is the sum of the weights of the criteria it meets; above the threshold, a spotlight is created. Indicator-based criteria can evaluate snapshots; query-based criteria always use live data. New scores overwrite old ones. The *Spotlight Audits* list shows each criterion's contribution, which makes it an explainable "needs attention" scorer (e.g. old + reassigned 3× + VIP + breached). [SN]
- **Visualization catalogue** — Next Experience visualizations: single score (sparkline by default since Australia), dial, gauge with colour ranges, vertical and horizontal bar, Pareto, pie and donut, time series, multidimensional, bubble, heatmap (two fields or two breakdowns), pivot table and list. Classic report types add multilevel pivot, funnel, pyramid, line, area, spline, column, trend, histogram, box, control chart, calendar, map, speedometer and semi-donut (by release; partly unverified). [SN]
- **Dashboards and distribution** — Platform Analytics dashboards with tabs, interactive filters (including cascading and "follow" filters), drill-down to records, sharing to users, groups and roles as owner, editor or viewer, PDF export, and scheduled report e-mail (PDF, Excel, CSV, PNG). Analytics also embed in workspace landing pages. [SN]
- **Content packs, benchmarks, process mining** — Prebuilt ITSM indicators and dashboards: incident, problem, change, request, knowledge, SLA, CMDB health, Change Success Score. The base system includes a complimentary, limited PA for Incident. A *Benchmarks* app compares KPIs with anonymised peers. *Process Mining* (ITSM Advanced) shows process maps, variants, rework loops and bottlenecks. [SN]
- **Now Assist / Otto in Platform Analytics** — A natural-language question goes through *Query Generation* and returns a visualization with suggested follow-up questions. *AI Data Explorer* opens from a list or visualization; Australia Patch 1 added protected-scope data. Dashboards and visualizations can be generated and exported (e.g. "open P1 incidents" becomes a single score, exported as PDF); the export skill has been on by default since Jan 2026. Australia Patch 4 added indicator-data querying. [SN] [AI]
- **JSM built-in reports** — Fixed default reports: *Workload*, *Satisfaction*, *Requests deflected*, *Requests resolved* (with or without KB). Editable defaults: *Created vs resolved*, *Time to resolution*, *SLA met vs breached*, *SLA success rate*, *Incidents/Problems by priority*, *Change by type*, *Time to approve normal change*. Custom reports take up to 20 series (metric, label, colour, JQL or "JQL from SLA goal" filter). Reports go to Jira dashboards via a gadget, and filter subscriptions e-mail results on a schedule. [JSM]
- **JSM Operations reports** — Alert MTTA and MTTR, alert analytics (by source, priority, tag, team, hour, weekday; created vs closed), notification analytics, on-call time, team and user productivity, and an AI noise-reduction view. [JSM]
- **Atlassian Insights (formerly Atlassian Analytics)** — Rovo natural-language questions return SQL-backed answers. Also: a data catalog and glossary, and 9 (Standard) or 18 (Premium/Enterprise) third-party sources such as Snowflake, BigQuery, Databricks and PostgreSQL. Enterprise adds data lineage and the Atlassian Data Lake. AI questions use Rovo credits. [JSM] [AI]
- **Atlassian advanced dashboards (Enterprise)** — *Visual SQL*: a visual mode with steps, formulas (including AI-written formulas) and merges with join types, plus an SQL mode with AI-generated SQL and version history. 16 chart types: area, bar, bar-line, box plot, bubble, bubble map, bullet, funnel, heat map, line, map, pie, scatter, single value, single-value indicator, table. Controls: calendar, date bucket, date slider, dropdown, range, text, hidden, and charts as controls. Templates include *Incident/Change/Request management overview* and *Service desk scorecards* (customer experience, operations, requests needing attention). Also chart comments, Confluence embeds, scheduled subscriptions and AI chart insights (describe, trends, anomalies). Limits: 100k rows for tables, 10k for most charts, 20 MB per chart. Data Lake connections are either permission-enforced or unpermissioned; *data shares* for external BI do **not** enforce Atlassian permissions. Data refreshes about every 30 minutes (community report). [JSM]
- **Freshservice Analytics** — A report is a canvas on a 16×9 grid. New reports are private by default and shared with users who have the "view analytics" permission. The widget *Gallery* offers templates or existing widgets. Widgets resize in four directions and open in expand mode or a quick-edit side panel. Text and image widgets are available. Charts: bar, stacked bar, horizontal bar, pie, donut, heat map, summary table. Several metrics fit on one widget, with group-by on up to 2 attributes and filters at widget, page and report level. Clicking a segment drills down; "Show underlying data" opens a configurable table. Widget export: CSV, XLSX, PDF. Widget schedules run hourly, daily, weekly or monthly in a chosen time zone; report schedules send PDF only. Presentation mode cycles pages every 5, 10, 15, 30 or 60 s. Report lists: All, Private, Shared, Curated, Owned, Trash, Schedules. Data syncs in about 40 minutes and excludes spam, trash and merged tickets. Analytics reports cannot be placed on helpdesk dashboards. [FS]
- **Ask Freddy, Copilot reports, AI Insights** — Ask Freddy turns an NLP question into a widget, from an Ask bar that shows recent queries (Analytics Pro). Copilot reports measure AI adoption and impact and are shareable as view, edit or manage. Freddy AI Insights (Enterprise) adds proactive insight cards, e.g. SLA violations and root-cause trees. [FS] [AI]
- **BMC Helix Dashboards** — Grafana-based dashboards across ITSM, SLM, CMDB, AIOps, DWP, Business Workflows, CSM and even ServiceNow sources. Includes out-of-the-box dashboards, scheduled reports to internal or external e-mail (and FTP), sharing inside and outside the tenant, and recovery of deleted dashboards. 26.3 adds usage, permission and schedule monitoring, Arabic RTL and a Custom Data Integrator. *Value dashboards* compare MTTR, response time and SLA adherence for AI-assisted vs non-assisted tickets. [BMC]
- **HelixGPT Insight Finder** — Builds dashboards and panels from natural-language prompts over ITSM, AIOps and vulnerability data with no SQL. Sessions can be cleared and restarted. PDF export is multilingual. SaaS only. [BMC] [AI]
- **ServiceDesk Plus reports** — 150+ predefined reports. Custom report types: *Tabular*, *Matrix* (row × column), *Summary*, *Audit*, *CI History*, *Request Metrics*. *Query reports* run SQL (on-prem). *Flash reports* take one-click module snapshots. Schedules run daily, weekly, monthly, yearly or once and send PDF, XLS/XLSX, CSV or HTML, with "skip if no data". Report folders support sharing. Dashboards hold widgets (bar, pie, line, pyramid, summary cards) with ticket actions directly from a widget. [ME]
- **Analytics Plus / Zoho Analytics + Ask Zia** — Synced ServiceDesk Plus modules: cloud covers requests, tasks, changes, projects, users and assets; on-prem adds incidents, request history, catalog, solutions and surveys. Prebuilt help-desk KPI dashboards can be embedded in ServiceDesk Plus. *Ask Zia* builds reports from voice or text questions. *Zia Insights* writes narrative descriptions of charts. Power BI and DOMO connectors are available. [ME] [AI]
- **Halo reporting** — Reports have a Chart Setup step: X/Y fields, Sum or Count, bar, horizontal bar, line, area, pie, doughnut, funnel, multi-series and stacked charts, a line overlaid on bars, and trendlines on bar, line and area charts. Scheduled e-mails include charts, and PDF templates embed them via `$-REPORTCHART`; doughnut charts are not allowed in scheduled reports. Dashboards are unlimited and each widget is a report. Halo AI adds prompt-defined "AI report creators", AI report summaries with recommendations, QBR packs and forecasting. SQL-based custom reports are widely reported (unverified in fetched docs). [Halo] [AI]
- **Zendesk Explore (reference)** — Dataset-based queries with metrics, attributes and calculated metrics and attributes, plus dashboards with interactivity controls. Scheduled dashboard delivery (CSV, Excel, PNG, PDF) runs for up to 12 months ahead. External recipients require Explore Enterprise. Sync lag is up to about 2 h, so daily schedules should run after 02:00. [ZD]

**B. Target capability set (union of the best tools)**
- **Governed metric layer** — Metrics are defined once (formula, filters, time basis calendar or business, unit, direction "higher is better", owner, certification badge) and reused by lists, reports, dashboards, SLAs and natural-language answers, so numbers always match. Patterns: [SN] indicators, [JSM] Insights catalog and glossary, [BMC]/[ME] semantic-layer practice.
- **Query model** — Measures (count, count distinct, sum, average, median, p50/p90/p95, min, max, rate, ratio), dimensions (up to 2–3 levels of group-by), relative date ranges, time grains (hour to fiscal year), period-over-period comparison, running windows, buckets, calculated fields, joins across modules (incident ↔ CI ↔ change), and a visual and SQL dual mode for power users ([JSM] Visual SQL, [ME] Query reports).
- **Visuals** — Single value with sparkline and delta, gauge/bullet against target, bar/column (stacked, 100%), line/area, combo bar-line, pie/donut, funnel, heatmap (e.g. weekday × hour arrivals), pivot/matrix, box plot (resolution-time spread), scatter, histogram, control chart, Pareto (top categories), Sankey/flow (reassignment paths), calendar heatmap, geo map, treemap, table with conditional formatting.
- **Interaction** — Click to drill down (breadcrumb of the applied drill path), drill-through to the live record list *and* the historical snapshot, cross-filtering between widgets, dashboard-level filters and variables, "view underlying data", tooltips with exact numbers, legend toggles, and a "last refreshed" timestamp.
- **Distribution and governance** — Private, shared (user, group, role) and public-link sharing with view, edit and manage rights; scheduled delivery (e-mail, Slack/Teams) as PDF, PNG, CSV or XLSX with time zone; threshold alerts and subscriptions; embedding in workspaces, portals and forms; presentation/TV mode; usage analytics on dashboards; versioning and restore of deleted dashboards ([BMC] 26.3); row-level security identical to the app.
- **AI** — Natural language to chart, AI chart narratives ("what changed and why"), anomaly and signal detection, forecasting, driver/contributor analysis, auto-generated dashboards, and AI value dashboards comparing AI-assisted and unassisted cohorts ([BMC], [FS] Copilot reports). [AI]

**C. Report-builder and dashboard UX patterns**
- **Five-click creation** — "New report" opens a canvas at once and naming happens later; a widget gallery of templates; configure before save; a context-sensitive side panel (chart, text/image, group, or nothing selected); edit-vs-view state always visible. [FS]
- **Hub page per KPI** — Score, target gap, trend, breakdown table and contributing records on one page, with comments for annotations such as "outage on 3 Mehr". [SN]
- **Insight cards above charts** — Signals, threshold breaches and key contributors are surfaced as cards, so managers read conclusions first and charts second. [SN] [JSM AI chart insights]
- **Ask bar** — A natural-language box at the top of analytics showing recent and suggested questions; the answer is an editable widget, not a dead image. [FS] [ME] [SN] [AI]

### Implementation notes
- **Two analytics tiers.** (1) Real-time operational aggregates from the OLTP store for lists and queues (counts, SLA timers). (2) An analytics store fed by change-data-capture (CDC) into a columnar engine (e.g. ClickHouse, DuckDB, or Postgres with materialized views), using a star schema: `fact_ticket`, `fact_ticket_state_interval` (one row per state/assignment interval, giving time-in-state, reassignment paths and pause time), `fact_sla_instance`, `fact_change`, `fact_alert`, `fact_survey_response`, `fact_kb_event`, `fact_ci_health` (daily), with dimensions for user, group, service, CI, category and date.
- **Snapshots for history.** Store daily (or per-frequency) scores per indicator × breakdown element, plus record-id arrays for drill-back like [SN] snapshots. Backlog-at-date can then be answered without replaying history. Recompute a period only when late events arrive (watermark), and keep `collected_at` for auditability.
- **Time semantics.** Every duration metric must state its clock: calendar or business (schedule plus holidays), with pauses subtracted. Implement one business-time service (interval arithmetic over expanded schedule spans) and reuse it for SLAs, KPIs and on-call. Report median and p90 next to the mean, because ticket durations are heavily right-skewed.
- **Persian and Jalali.** Use Jalali date buckets (weeks Saturday–Friday, months Farvardin–Esfand, fiscal year starting 1 Farvardin by default but configurable), Asia/Tehran (no DST since 2023), Persian digits and separators (٬ for thousands, ٫ for decimals), and mirrored chart layouts: legend and axes on the start side, an optional right-to-left time axis (configurable, because some teams prefer the mathematical left-to-right convention). Keep Gregorian available for multinational reporting.
- **NL→query safety.** Map a question to *metric + filters + grain* through function calling over the semantic layer, not raw SQL. Execute as the asking user under row-level security, show the generated definition ("MTTR, business hours, P1–P2, last 30 days"), and let the user pin the result as a widget.
- **Signal detection.** Run XmR/Shewhart rules (point beyond 3σ, 8 consecutive points on one side, 6 increasing points) per indicator. Add seasonal decomposition (STL) for weekly seasonality before anomaly scoring. Use Holt-Winters or Prophet-style forecasting with prediction intervals. Store explanations (top contributing breakdown elements by delta share) to feed AI narratives.

## Module: incident

### Features
**KPIs (formula · typical target)**
- **Volume and arrival pattern** — Incidents opened per period by channel, service, CI, category and priority, plus a weekday × hour heatmap. Feeds staffing models (Erlang C) and capacity planning. [ITIL 4]
- **MTTA (mean time to acknowledge)** — Σ(first acknowledgement or assignment acceptance − created)/N; define the event explicitly. Typical: P1 ≤ 5–15 min, P2 ≤ 30 min, on-call pages ≤ 5 min. [heuristic] [JSM Operations reports]
- **First response time** — First public response − created, in business time. Report median and p90. Typical: ≤ 1 business hour for P3/P4, near-immediate for chat. [HDI]
- **MTTR (mean time to resolve/restore)** — Σ(resolved − created − paused time)/N per priority. State the clock (calendar or business) and the reopen rule (final vs first resolution). Typical: P1 ≤ 4 h, P2 ≤ 8 h, P3 ≤ 3 business days. Show median and p90. [ITIL 4]
- **FCR (first contact resolution)** — Incidents resolved during the first contact, with no handoff or callback, ÷ incidents eligible for FCR. MetricNet average ≈ 74% (range 38–98%; secondary source). Typical goal 70–80% for phone/chat. FCR is a quality metric that drives CSAT. [HDI/MetricNet]
- **First-level resolution (FLR)** — Resolved by L1 without escalation ÷ total. MetricNet 2023: 78.9%. This is a cost metric. [HDI/MetricNet]
- **First-time fix rate** — Resolved and not reopened or revisited within N days ÷ resolved. Typical ≥ 85–90% (field visits ≈ 75–85%). [heuristic]
- **Reopen rate** — Reopened within 7–14 days ÷ resolved. Target < 5%. [heuristic]
- **Escalation rate** — Functional (moved to a higher tier) ÷ total, reported separately from hierarchical (management) escalations. Also mean reassignment count and "ping-pong" share (incidents with > 2 reassignments); target mean < 1.5 hops. [heuristic]
- **Backlog, net flow, aging** — Backlog = open at period end. Net flow = created − resolved ([JSM] scorecard template). Aging buckets (0–1 d, 1–3 d, 3–7 d, 7–30 d, > 30 d) by priority, plus "% older than SLA target" and the oldest item. [JSM] [SN]
- **SLA compliance and breach rate** — Met ÷ (met + breached), counted per SLA instance (response and resolution separately) and excluding cancelled SLAs. Breach rate = 1 − compliance. Also *at risk* (≥ 75% elapsed and not breached). Typical targets: 95% overall, 99% for P1 response. [ITIL 4]
- **Major incident metrics** — MI count and share of total, MTTR(MI), time to declare (detection → MI flag), time to first stakeholder update, update-cadence adherence, PIR completed within 5 business days, PIR action closure rate. [ITIL 4] [heuristic]
- **Quality and causation** — Repeat incidents (same CI and category within 30 days), change-caused incidents (`caused_by_change` set ÷ total), incidents linked to problems, CI-populated rate (target ≥ 90%), proportion detected by monitoring vs reported by users. [ITIL 4]

**UX patterns (agent record page)**
- **Record header with SLA timers** — Number, title, state chip, priority badge (colour *and* text), requester and VIP decorator, assignee, and primary actions (Assign to me, Resolve, Promote to major). SLA chips show a countdown, % of goal elapsed and the business calendar on hover. In [JSM]: aqua clock = running, pause icon = paused, red clock = overdue, red X = breached, green check = met; yellow when close to breach. [SN] adds a process-flow state breadcrumb. [SN] [JSM]
- **Overview tab with AI card** — An AI incident summary and suggestions card sits on the Overview tab (Australia). The Related records tab shows attached knowledge by default (Brazil). [SN] [AI]
- **Activity stream** — One time-ordered feed of public comments, internal work notes, field changes, e-mails, approvals, system and AI events. Internal notes look visibly different (tinted background or lock icon). Filter chips by type, collapsible tiles, and back-dated notes ("Add to past") for timelines. [SN] [JSM] [FS]
- **Composer** — A public reply / internal note toggle with distinct colours and a warning before a public post. "/" opens macros, canned responses and response templates with placeholders. Also: KB insert as link or content, @mentions, attachments, "send and set status", and AI actions (draft reply from context and similar incidents, improve writing, change tone, shorten or expand, translate). [ZD] [FS] [SN] [JSM] [AI]
- **Contextual side panel** — Tabs for record information (requester card with the 10 most recent records, assets, SLAs), Recommended actions/agent assist, AI Search, response templates, Collaborate (Teams) and the action library. The CI dependency view opens in a workspace tab. [ZD] equivalent: a context panel toggling customer context and apps, with task lists. [FS]: Freddy panel with insights and related tickets. [SN] [ZD] [FS]
- **Conversational investigation** — Incident assist agentic workflow (in the Now Assist panel): ask about caller assets, recent and similar incidents, SLA risk, related changes, outages, CIs and on-call experts. [SN] [AI]
- **Collision indicators** — Live presence showing who is viewing and who is replying, plus a "someone updated this record" refresh prompt. [FS] has real-time agent collision detection (viewing/replying). For [ZD], avatar indicators in the ticket header are reported only anecdotally (unverified); its documented typing indicator is for *customers* in messaging. Newer tools (e.g. Pylon) show viewer avatars and highlight a colleague's editor while they type. [FS] [ZD]
- **Major-incident war room** — [SN] Major Incident Workbench: one pane for the MI manager, comms manager and resolvers (overview, timeline, communication plans and tasks, child incidents, affected CIs/services, conference calls), PIR built from flagged activity events, add similar incidents as children. [JSM]: a major-incident toggle moves the work item into a "Major incidents" queue; incident timeline; stakeholder groups linked to services; native conference calls (≤ 50 participants); Slack/Teams/Zoom channels with action cards; AI summary for responders who join late; AI timeline compiled after resolution. [JSM] *Incident Command Center* (EAP 2026) has five tabs (Overview, Investigation with confidence-rated hypotheses and live telemetry, Mitigation plan, Communications drafts, PIR). [FS]: PIR widget and Freddy PIR generator; FireHydrant joined in Q1 2026. [SN] [JSM] [FS] [AI]

### Implementation notes
- The server stores SLA deadlines and pause intervals. The client only renders the countdown from `deadline − now − pending pauses`, and the server pushes recalculations over WebSocket when state changes (pause or resume). Never compute breach status in the browser.
- Presence: a WebSocket channel per record with `viewing`/`typing-public`/`typing-internal` states and a 30 s heartbeat TTL. Show avatars in the header and block a public send if another agent posted publicly in the last N seconds (opt-in).
- Activity stream: an append-only `journal` (record, type public/internal/system/ai, author, body, visibility, created_at, backdated_at), merged at read time with `audit` (field diffs) and `email_log`. AI-generated entries carry `generated_by_ai` plus the model and prompt id for audit.
- KPIs need `fact_ticket_state_interval` to compute time-in-state, pause time, hop counts and "first contact" (resolved with zero reassignments in the first session or channel interaction).

## Module: problem

### Features
- **Problem KPIs** — Open/closed problems and backlog aging. *Problem coverage* = incidents linked to a problem ÷ incidents (or the share of top-N recurring categories covered). *Time to root cause* = RCA identified − created; target ≤ 30 days for P1/P2 problems. *Time to permanent fix* = fix change implemented − RCA. *Known errors with a workaround* ÷ known errors. Major incidents with a problem record target 100%. *Recurrence reduction* = incidents per CI or service in the 90 days after the fix vs before. Proactive-to-reactive ratio (trend-based vs incident-driven problems). Problems closed via change ÷ closed. [ITIL 4] [SN] [FS]
- **Problem dashboards** — Open problems by state and age, known errors, incidents per problem, time to RCA and fix, problem → change linkage. AI clustering jobs propose candidate problems: [BMC] ITSM Insights, [FS] similar-ticket clustering, [SN] problem investigation agent. [SN] [BMC] [FS] [AI]

### Implementation notes
- Store `rca_identified_at`, `workaround_published_at` and `fix_implemented_at` as explicit milestones, not derived from state names, so KPIs survive workflow customisation.
- For recurrence reduction, compare equal windows and normalise by the CI population to avoid survivorship bias.

## Module: change

### Features
**KPIs**
- **Change success rate** — Changes closed successful ÷ changes implemented (excluding cancelled). Typical ≥ 95% for normal changes, ≥ 98–99% for standard. [ITIL 4]
- **Change failure rate** — Changes failed, backed out or causing an incident ÷ implemented. Aligned with the DORA definition for deployments. [ITIL 4] [DORA]
- **Emergency change %** — Emergency ÷ total changes. Target < 5–10%; a rising trend signals weak planning. [heuristic]
- **Unauthorized change count** — Configuration changes found by discovery, drift or FIM with no approved change record. Target 0; reported as count and as % of detected changes. [ITIL 4]
- **Change-caused incidents** — Changes linked as `caused_by` to ≥ 1 incident ÷ implemented changes (target < 2–5%), and incidents caused by change ÷ all incidents. [SN] [JSM]
- **Lead time** — Implemented (or approved) − submitted, by type and model. *Approval cycle time* = approved − submitted for approval. [JSM] "Time to approve normal change" report. [JSM] [SN]
- **CAB metrics** — % of changes reviewed by CAB (modern guidance ≈ 5–15% of volume), changes per meeting, average decision time per agenda item, CAB-to-implementation time, decisions deferred. [SN] [heuristic]
- **Backout/rollback rate** — Changes rolled back ÷ implemented. Target < 2–3%. [heuristic]
- **Schedule compliance** — Changes implemented outside their maintenance window or inside a blackout/freeze (target 0), and late changes submitted below the policy lead time. [SN] [JSM]
- **Standard-change ratio and automation** — Standard (pre-approved) ÷ total, rising over time (mature organisations ≥ 50–70%). Also auto-approved pipeline changes ÷ total. [heuristic] [SN DevOps Change Velocity]
- **Conflict and risk metrics** — Conflicts detected and unresolved at approval, risk-score distribution vs actual outcome (risk-model calibration), PIRs completed for failed or emergency changes. [SN] [JSM]
- **Change Success Score** — A team-level, credit-score-like rating built from historical outcomes with formula indicators and four colour bands, refreshed by a daily job. It feeds approval policies, e.g. auto-approval for high-scoring teams. [SN]

**UX patterns**
- **Change calendar / schedule** — Day, week, month and timeline views of changes, with maintenance windows (shaded "preferred"), blackout/freeze windows (hatched "no change"), information schedules and conflict badges. [JSM]: cross-space calendar with a JQL filter builder (any field, Assets objects, affected services), a shareable filter URL, event-type filter, a default view per space, and an iCal subscription that unlicensed staff can open. [SN]: Change Schedule in Core UI and SOW. [FS]: change calendar with maintenance-window association and a read-only "overlapping blackout window" field. [SN] [JSM] [FS]
- **Conflict detection feedback** — Conflicts run automatically when CI or dates change, manually from the form, and on a schedule. Each is listed with its type: CI already scheduled, parent/child CI scheduled, outside maintenance window, inside blackout, assignee double-booked, and (Brazil) inside *Change Lockdown*, which also puts the change on hold. [SN]
- **Risk insights panel** — A side panel on the change with a risk summary, conflicting changes in the window and 7 days after, freeze windows, open incidents on the same service, and the failure history for the service and the requester. [JSM] *Prevention Center* (EAP Nov 2026) adds an AI change summary, pre-risk assessment, service graph with active incidents, and calendar conflict detection. [JSM] [AI]
- **CAB workbench** — CAB definitions (recurrence, manager, delegates, attendees, agenda conditions that pull in changes, minutes per item) and a meeting view with agenda, a "current item" spotlight, live approve/reject, notes, attendance and a conference link. It runs in SOW (since Yokohama) and supports post-implementation review of recent changes (Zurich). [SN]
- **Scaled change and lockdown** — One parent spawns child changes per CI (e.g. 500 servers), each with its own schedule and conflicts. A lockdown pauses all or a filtered set of in-flight changes during a crisis. [SN] Brazil

### Implementation notes
- Model windows as schedules (RRULE + time zone + exclusions). Conflict detection becomes an interval-overlap query over (CI ∪ parents ∪ children within N hops) × planned interval, run asynchronously, with results stored in `change_conflict` (type, other record, window) and re-run on any edit to CIs or dates.
- The calendar needs virtualised rendering for thousands of events, server-side expansion of recurring windows per visible range, and colour-blind-safe encodings (pattern for blackout, not just red).
- Store `risk_predicted` vs `outcome` so a calibration report (reliability diagram) can tune risk rules and AI models.

## Module: devops

### Features
- **DORA five metrics** — Throughput: *deployment frequency* (production deployments per service per day or week), *lead time for changes* (commit → running in production, median), *failed deployment recovery time* (failed deployment → restored; renamed from MTTR/time to restore in 2023 and limited to deployment-caused failures). Instability: *change failure rate* (deployments needing immediate remediation such as rollback or hotfix ÷ deployments) and *rework rate* (unplanned deployments caused by production incidents ÷ deployments; e.g. 3 of 10 = 30%; added 2024, first benchmarks in 2025). The 2025 report ("State of AI-assisted Software Development") replaced elite/high/medium/low tiers with per-metric distributions. Historical elite marks: on-demand deploys, lead time < 1 day, recovery < 1 h, CFR ≈ 5% (2024; unverified exact). [DORA]
- **ITSM linkage** — Each deployment maps to a change record, created automatically from the pipeline with risk-based auto-approval. Incidents with `caused_by_change` feed CFR and rework rate. Deployment-gating outcomes (approved, blocked) are reported per pipeline. [SN DevOps Change Velocity] [JSM deployment gating]

### Implementation notes
- Ingest deployments via webhooks (GitHub, GitLab, Azure DevOps, Jenkins), keyed by service and environment, and dedupe re-runs. Define "failure" as a linked incident or a rollback/hotfix deployment within N hours. Compute per service with medians over rolling 30/90 days.

## Module: request

### Features
- **Request KPIs** — Volume per catalog item and category. *Fulfilment time* = closed − submitted, against each item's promised delivery time. % fulfilled within SLA. *Approval cycle time*. *First-time-right* = requests not returned to the requester for information ÷ total. *Automation (zero-touch) rate* = requests fulfilled fully by flows ÷ total. *Portal adoption* = requests via portal or VA ÷ all channels. *Cart/form abandonment* = started − submitted ÷ started. *Time waiting on requester* share. Cost per request and CSAT per item. [ITIL 4] [SN] [JSM]
- **Request dashboards** — Request volume by item, fulfilment time per stage, approval cycle time, SLA attainment on request items and tasks, and the virtual-agent and portal deflection items. [SN] [JSM "Service requests" report]

### Implementation notes
- Track stage timestamps per catalog item (submitted, approved, in fulfilment, delivered). Each stage gets its own time-in-stage fact, so bottlenecks show per stage instead of one opaque fulfilment number.

## Module: knowledge

### Features
- **Link rate** — Cases closed with ≥ 1 linked article ÷ cases closed. KCS treats this as an *activity* measure, not a goal; a link rate > 60% with link accuracy > 90% is cited as making knowledge insights credible (secondary source). [KCS]
- **Reuse vs create** — Reuse rate = cases resolved by an existing article ÷ cases with a linked article. A healthy pattern is internal reuse ≥ creation. [KCS]
- **Participation rate** — Assisted cases producing a knowledge event (create, reuse, flag or modify) ÷ assisted cases. [KCS]
- **Article Quality Index (AQI)** — Sampled articles scored against the Content Standard Checklist (unique, complete, findable title, environment and cause present, correct links, readable). AQI = 100 − Σ(weighted defects) ÷ articles sampled. Target ≥ 90%. [KCS]
- **Self-service use and success** — KCS adoption goal: customers use self-service first ≥ 85% of the time and find what they need ≥ 85% of the time. Measured with surveys plus behaviour, because no single % is reliable. [KCS]
- **Deflection rate** — Self-service sessions (search, article view, VA conversation) not followed by a ticket from the same user within 24–72 h, or explicitly marked "this solved my problem", ÷ sessions. [JSM] *Requests deflected* report; [SN] VA deflection tracking. [JSM] [SN]
- **Search success** — Zero-result search rate (target < 10%), click-through rate, top failed queries → knowledge gaps. [SN] AI Search analytics. [SN]
- **Freshness** — % of articles reviewed within the review period (e.g. 6–12 months), % past review date, average days since last review, time from draft to publish, feedback backlog and time to address flagged articles. [SN] [KCS]
- **Helpfulness** — Useful-vote ratio, rating, views per article, and resolved-with-KB vs without-KB ([JSM] *Requests resolved* report). [JSM] [FS]

### Implementation notes
- Log knowledge events (`view`, `search(query, results_count)`, `link(case, article, mode=reuse|create)`, `feedback`, `vote`) as a stream. Every metric above is a query over this stream, with sessionisation for deflection.
- An AQI workflow samples N articles per author per month into a review task with a weighted checklist form, and stores per-criterion results for coaching.

## Module: cmdb

### Features
**KPIs (CMDB health)**
- **Completeness** — CIs with all *required* attributes populated ÷ CIs in the class, scored separately for *recommended* attributes. [SN CMDB Health]
- **Correctness** — 1 − (duplicates + orphans + stale) ÷ CIs. *Duplicates*: CIs the identification and reconciliation engine (IRE) flags as the same entity. *Orphans*: CIs missing required relationships, e.g. an application with no host. *Stale*: not updated or discovered within a per-class "N days" threshold (e.g. 30/60/90). [SN]
- **Compliance** — CIs passing audit or certification templates (expected values and relationships) ÷ CIs audited. Remediation tasks go to CI owners or groups. [SN]
- **Health score** — Weighted average of the three, per class and owner group, with trend lines and drill-down scorecards. [SN]
- **Coverage and usage** — Discovery coverage (discovered ÷ known CIs, e.g. reconciled against ITAM, AD and cloud accounts), discovery error rate, relationship coverage (CIs with ≥ 1 relationship), service-mapping coverage (business services with mapped dependencies ÷ total), certification completion on time, CI-populated rate on incidents and changes (≥ 90%), and physical-audit accuracy (≥ 95–98%). [heuristic]

**UX patterns (dependency maps)**
- **Dependency/impact map** — An interactive graph centred on a CI or service. Expand neighbours one level at a time, filter by relationship type and class, overlay open incidents, changes and alerts, and highlight the upstream/downstream blast radius. In [SN] it opens in a workspace tab (Zurich); Brazil merges CMDB Workspace into Service Graph Workspace. [JSM] shows service-graph blast radius in incidents, changes and the Prevention Center. Assets has a graph viewer. [FS] uses Device42-based dependency maps. [SN] [JSM] [FS]
- **CMDB workspace** — Health cards, class navigator, guided remediation (duplicates, stale CIs), a "CMDB success advisor" (Australia) and data-manager dashboards ([JSM] Data Manager: source-coverage Venn and data-quality issues). [SN] [JSM]

### Implementation notes
- Store the graph in relational edge tables (`ci_rel(parent, child, type)`) with recursive CTEs capped at depth N for impact. Precompute `service_ci_closure` for fast "affected services". Render with a force or layered (dagre/ELK) layout, lazy-load neighbours, cluster above about 200 nodes, and always offer an accessible table view.
- Health jobs run nightly per class, write `fact_ci_health(date, class, metric, numerator, denominator)` and open remediation tasks idempotently.

## Module: itam

### Features
- **License position (ELP)** — Entitlements − consumption per product and licence metric (user, device, core, PVU, subscription), giving over-licensed (savings) vs under-licensed (compliance exposure) amounts in money. [ITIL 4 ITAM]
- **Utilisation and shelfware** — Utilisation = licences used (active in last N days, e.g. 30/90) ÷ assigned. Shelfware = assigned but unused for 90 days ÷ assigned, with reclaimed-licence savings. Also SaaS spend per employee. [heuristic]
- **Inventory accuracy** — Records matching a physical or agent audit ÷ records sampled. Target ≥ 95–98%. [heuristic]
- **Lifecycle health** — % of assets out of warranty, past end of support or end of life, refresh compliance, stock below minimum, lost/stolen rate, time to provision a device for a new hire. [JSM] HAM insights (expiring warranties, low stock, dormant "ghost" devices, incident-prone assets). [JSM] [AI]
- **TCO** — Acquisition + deployment + operation (support, maintenance, energy, licences, hosting) + disposal − residual value, per asset, model and service over its lifecycle. Supports repair-vs-replace decisions. [ITIL 4]
- **Contract metrics** — Renewals handled before the notice date, true-up exposure, cost avoidance from renegotiation or reharvest. [heuristic]

### Implementation notes
- Reconcile discovery, MDM, finance and SaaS SSO logs into one normalised software and asset catalogue (publisher, product, version, edition) before any ELP. ELP is a per-licence-metric calculation engine with rule packs per publisher.

## Module: slm

### Features
- **SLA, OLA and UC attainment** — Per definition, service, customer and priority, counted on SLA instances. Also paused-time share, breach trend, at-risk counts, penalties or service-credit exposure, and supplier (underpinning contract) attainment. [ITIL 4] [SN] [JSM]
- **CSAT** — Satisfied responses (4–5 on a 5-point scale) ÷ responses × 100. Typical 85–95%. Report the response rate alongside, plus CSAT by agent, team, request type and service. [JSM] CSAT 1–5 stars on resolution. [JSM] [FS] [HDI]
- **NPS** — % promoters (9–10) − % detractors (0–6), from −100 to +100. Used for relationship (periodic) surveys of IT, not per ticket. [ME] Zoho Survey integration reports NPS (Mar 2026). [ME]
- **CES (customer effort score)** — Mean agreement with "it was easy to get my issue handled" on a 1–7 scale, or % agree. Target ≥ 5.5/7 (heuristic). Effort is the strongest predictor of disloyalty in support contexts. [heuristic]
- **XLA (experience level agreement)** — A composite of experience indicators (sentiment/CSAT, effort, perceived lost productivity hours per ticket, and DEX telemetry such as boot time, crash rate and app performance), each with a target and weight, rolled into an XLA score per service. Available in [FS] Enterprise. [FS] [heuristic]
- **SLO attainment and error budget** — SLI = good events ÷ valid events. SLO attainment over a 28/30-day window. Error budget = 1 − SLO (99.9% gives 43.2 min per 30 days). Budget consumed = (1 − SLI) ÷ (1 − SLO). Burn rate = observed error ratio ÷ (1 − SLO). Multi-window, multi-burn-rate alerts per the SRE Workbook: page at 14.4× (1 h long / 5 min short window, 2% of budget) and 6× (6 h / 30 min, 5%), open a ticket at 1× (3 d / 6 h, 10%). Error-budget policy: freeze risky changes when the budget is exhausted, linked to change-approval rules. [SRE]

### Implementation notes
- Use one SLA engine with definitions (start, pause, stop and cancel conditions; schedule; time-zone source; target duration per priority) creating `sla_instance` rows. Breach, warning and at-risk thresholds (e.g. 50/75/100%) emit events for notifications and analytics.
- Surveys: one `survey_response(question_type CSAT|NPS|CES|free_text, score, ticket_id, service_id)` model. AI summarises free-text themes per period.

## Module: event

### Features
**KPIs**
- **Noise and quality** — Events → alerts → incidents compression ratio, noise-reduction % (alerts suppressed or grouped ÷ raw), false-positive rate (alerts closed as no action ÷ alerts), signal-vs-noise classification. [JSM] AI grouping and signal/noise views (2026). [JSM] [AI]
- **Detection and response** — MTTD (impact start → first alert), alert MTTA and MTTR, % incidents auto-created by monitoring vs reported by users (target: majority from monitoring), auto-remediation rate. [JSM] Operations reports. [JSM]
- **On-call health** — Pages per shift, after-hours pages per person per week, ack-within-SLA %, escalations past level 1, on-call time per user (fairness), notification delivery success ([SN] Brazil adds delivery tracking). [JSM] [SN]

**UX patterns (on-call)**
- **Schedule builder** — Schedules (time zone) made of rotations (daily, weekly, custom; participants can be users, teams or "no one"). Shift templates include 24×7, Mon–Fri 08–17, weekday nights and weekends. Layers: *Base*, *Overrides*, *Final* (who was actually on call) and *Forwarding*. Overrides can be self-service ("Take on-call" for 1 h) or done on someone's behalf. A "Your shifts" calendar, @oncall aliases in Slack/Teams, mobile "My on-call times", and schedule start/end notifications. [JSM]
- **Escalation policy editor** — Ordered rules with delays and conditions (not acknowledged / not closed); targets are users, teams, schedule on-call, next/previous on-call or a random member; repeat; global policies. [JSM]
- **ServiceNow On-Call Scheduling** — Rotas and rosters with escalation sets, monthly rotations and bulk onboarding (Australia), "consult on-call experts" inside incident assist, and a Teams-native on-call agent (Aug 2026). [SN] [AI]
- **Alert console** — Grouped alerts with a timeline, dedup counts, source, tags and priority. Actions: ack, assign, snooze, close, create incident. Heartbeats and maintenance windows suppress noise. [JSM]

### Implementation notes
- Model schedules as layered interval sets: final = base ⊕ overrides ⊕ forwarding, evaluated per time zone. Precompute the next 90 days for the UI and gap detection (render gaps in red with a "fix gap" action). Escalations run as durable timers.

## Module: continuity

### Features
- **Availability %** — (agreed service time − downtime) ÷ agreed service time × 100, measured on the agreed service hours. Monthly downtime budgets: 99.9% ≈ 43.8 min, 99.95% ≈ 21.9 min, 99.99% ≈ 4.4 min (52.6 min per year). [ITIL 4]
- **MTBF, MTRS, MTBSI** — MTBF (mean time between failures) = total uptime ÷ number of failures, measured from restoration to the next failure. MTRS = total downtime ÷ failures. MTBSI (mean time between service incidents) = MTBF + MTRS, measured from the start of one incident to the start of the next. Also outage minutes and customer-minutes impacted per service. [ITIL 4]
- **Capacity and continuity** — Utilisation vs threshold, headroom and forecast exhaustion date. DR tests: actual recovery time vs RTO and data loss vs RPO. % critical services with a tested plan in the last 12 months. BIA coverage. [ITIL 4]

### Implementation notes
- Derive downtime from outage records (start, end, type outage/degradation/planned, % impact) rather than incident durations. Weight partial degradation by impact %, and exclude planned maintenance only when the SLA says so.

## Module: security

### Features
- **Detection and response times** — MTTD (first malicious activity → detection), MTTC (detection → containment), MTTR (detection → recovery), per category and severity. [heuristic]
- **Vulnerability remediation SLA** — Vulnerabilities fixed within the policy window ÷ fixed, per severity. Typical policies: critical 7–15 days, high 30, medium 90, low 180. US CISA BOD 19-02 required 15 days (critical) and 30 days (high) for internet-facing systems; KEV catalogue items have due dates. Also mean time to remediate, backlog aging, scan coverage (% assets scanned in 7/30 days), exceptions/risk acceptances, and patch compliance %. [SN Vulnerability Response]
- **GRC indicators** — Control test pass rate, open and overdue audit findings, policy exceptions, third-party risk tier distribution. [SN IRM]

### Implementation notes
- The remediation SLA clock starts at first detection, not ticket creation. Reopened findings (the same CVE on the same asset reappearing) continue the original clock unless verified as fixed in between.

## Module: financial

### Features
- **Cost per ticket/contact** — Total service-desk operating cost (labour, tools, facilities, overhead) ÷ tickets handled. MetricNet 2023 blended cost per contact ≈ $20.61, down from $22.56 in 2010. HDI cites about $22 for Level 1 (range $6–$40+). Desktop support is far higher (older MetricNet median ≈ $82). Cost rises with every escalation level. [HDI/MetricNet]
- **Cost per service / per user** — Direct plus allocated indirect costs per service, used for showback or chargeback. Also budget variance, cost of downtime (cost per hour × outage hours), and self-service savings ((deflected tickets × cost per ticket) − self-service run cost). [ITIL 4]

### Implementation notes
- Cost allocation needs time entries per ticket (agent rate × time) plus driver-based allocation of fixed costs (by tickets, users or CIs). Keep currency per cost centre and convert at the reporting date.

## Module: workforce

### Features
**KPIs (agent productivity)**
- **Throughput and handle time** — Tickets resolved per agent per day (HDI 2025 ≈ 21/agent/day, secondary source), AHT = handle + wrap-up time, backlog per agent, SLA attainment and reassignment rate per agent. [HDI]
- **Utilisation and scheduling** — Utilisation = handle time ÷ paid time (MetricNet correlates it with lower cost; typical 50–70%, heuristic), occupancy for chat/phone (75–85%), schedule adherence (≥ 90–95%), shrinkage (≈ 30%). [heuristic]
- **Quality** — QA rubric score (sampled ticket audits), CSAT per agent, reopen rate per agent, KCS participation, and AI-assist acceptance rate (suggestions used ÷ shown). [heuristic] [AI]

**UX patterns**
- **Supervisor workspace** — Team and queue dashboards, live agent states and capacity, reassign by drag-and-drop, and SLA-at-risk lists. [SN] Workforce Optimization; [FS] workload management (routing by availability and load, Pro). [SN] [FS]
- **Push routing inbox** — Advanced Work Assignment offers work items to available agents by capacity, skills and presence; agents accept or reject in an inbox. An AI routing-mode selector arrived July 2026. [SN] [AI]
- **Schedules, capacity and forecasting** — [JSM] Workforce Management (June 2026): team schedules and shifts (recurrence, time zone, unassigned shifts, coverage gaps), CSV bulk import with an error file, intelligent routing, capacity, and a forecasting tab on the space summary. [JSM] [AI]

### Implementation notes
- Capture agent presence intervals (available/busy/away/offline) so utilisation and occupancy are measurable. Forecast volume per queue and interval (seasonal model), then convert to staffing with Erlang C for real-time channels or a backlog-burn model for asynchronous tickets.

## Module: platform

### Features
**UX patterns of the best agent workspaces**
- **Global shell and navigation** — Unified Navigation: All, Favorites, History and Workspaces menus; a filter navigator that accepts `table.list` / `table.do` shortcuts; global and AI search in the header; preferences for display, accessibility, notifications and workspace. [SN] Atlassian uses a left sidebar of spaces and apps with starred and recent items. [JSM]
- **Keyboard shortcuts and command palette** — Ctrl+/ (Cmd+/) opens a searchable shortcut modal grouped into Page Action, Page Navigation, Global Navigation and General. Shortcuts are enabled in accessibility preferences, and admins and users can define custom shortcuts (Yokohama). [SN] J/K row navigation in queues. [JSM] "/" in the composer lists macros and chat shortcuts. [ZD] "e" edits ticket properties and a shortcut list sits under More (Freshdesk 2026; Freshservice parity unverified). Best practice: a ⌘K/Ctrl+K palette that mixes navigation, record search, actions on the current record and AI prompts. [SN] [JSM] [ZD]
- **List views** — Column chooser, multi-sort, condition builder (AND/OR groups), saved personal and shared filters, group-by with counts, inline edit guarded by a list-edit ACL, bulk update/assign/merge/close, "fuzzy count" for huge tables, and assign-to-me from the list (Yokohama). [SN] *Queues* are JQL lists with custom columns, SLA ordering, priority groups, starred queues, counts up to "999+", up to 300 queues per space per work category, slow-queue warnings, board and calendar views per queue, and Rovo `/manage-queue` (natural language → JQL and columns). Users report missing "my groups/my teams" filters for large desks. [JSM] Quick list view to move between tickets without leaving the detail page (Freshdesk 2026). [FS-family]
- **Kanban and timelines** — Visual Task Boards: freeform, flexible and guided (field-based lanes), with swimlanes and card colouring. [SN] Board view per queue. [JSM] Timelines appear as major-incident timelines, change calendars, request "support timelines" in the portal, and Gantt views for projects. [SN] [JSM]
- **Workspace tabs and multitasking** — Records open as tabs inside the workspace, with sub-tabs (CI map, related records) and drafts kept per tab. Interactions (chat, phone) show unread indicators and a wrap-up modal. [SN] [ZD]
- **Collaboration on the record** — Sidebar (Slack-like discussions attached to a record, with AI summaries; start Teams or Slack chats from it). [SN] Side conversations (e-mail, Slack, child tickets) in the context panel or main layout. [ZD] Native conference calls and incident channels. [JSM] Presence and collision indicators. [FS] [SN] [ZD] [JSM]
- **Notification centre** — A bell in the header with an unread badge and a grouped feed (direct vs watching, unverified for Atlassian's exact tabs). Per-user preferences per channel (e-mail, push, SMS, Teams/Slack) and device, digests, subscribable notifications, and deep links into the workspace record ([SN] e-mail links redirect to SOW since Xanadu). [SN] [JSM]
- **Mobile** — [SN] *Now Mobile* for requesters (catalog, approvals, knowledge, virtual agent, to-dos) and the *ServiceNow Agent* app for fulfillers (offline mode, barcode/RFID scanning, geolocation, on-call, inventory audits; Mobile App Builder). [JSM] Jira Cloud app: queues, approvals, alerts with distinct sounds, on-call shifts, take on-call/overrides, Assets QR scanning, plus the Rovo app. [FS] Native apps from Starter. [SN] [JSM] [FS]
- **Accessibility** — Next Experience accessibility preferences cover keyboard navigation, contrast, reduced motion, patterns instead of colours in charts, explicit date/time formats on forms, all buttons shown without hover, and special shortcuts. OS forced-colour and contrast settings are never overridden. Brazil adds reflow up to 400% zoom on key forms. [SN] Target **WCAG 2.2 AA**. Its new criteria matter for dense agent UIs: 2.4.11 Focus Not Obscured (sticky headers and side panels must not hide focus), 2.5.7 Dragging Movements (every drag in kanban, dashboards or calendars needs a click alternative), 2.5.8 Target Size minimum 24×24 CSS px, 3.2.6 Consistent Help, 3.3.7 Redundant Entry (do not re-ask data already given; prefill), 3.3.8 Accessible Authentication (no cognitive tests; allow paste and password managers). 4.1.1 Parsing is obsolete. [W3C]
- **Dark mode and density** — Coral theme dark mode on web and mobile (Zurich), Theme Builder with dark and compact variants, and a visual-density preference. [SN] Atlassian apps offer light, dark and match-system themes. [JSM] Best practice: three densities (comfortable, default, compact) and a tokenised theme, with charts re-validated for contrast in both themes.
- **RTL and localisation** — [SN] has 20+ language plugins including Hebrew and Arabic RTL, the Localization Framework (translation workflows, machine translation), Dynamic Translation for chat and records, and multilingual knowledge. [BMC] Dashboards added Arabic RTL in 26.3. [JSM] No native RTL was found for Jira Cloud: customers use Marketplace "RTL for Jira" (an RTL panel for descriptions in agent view and portal) and browser extensions. [FS] supports multiple portal languages and Freddy translation and multilingual reply suggestions. RTL support is a clear gap among leaders. [SN] [BMC] [JSM] [FS]

### Implementation notes
- Use one design-token system with CSS logical properties. Mirror layout, icons with direction (arrows, chevrons, "reply") and progress bars, but never mirror media controls, clocks, phone numbers, code, ticket IDs or Latin product names. Isolate mixed-direction strings with `<bdi>`/`dir="auto"` and wrap IDs in LTR spans.
- Keep a central keyboard registry (scope page/record/global, chord support, conflict detection, user remapping) that also feeds the shortcut modal and the command palette. Voice-control friendly labels = visible labels.
- For SLA timers, use `aria-live="polite"` announcements only at threshold crossings (warning, breach), not every second. All colour signals need a text or icon twin.
- Virtualise lists (10k+ rows), keep server-side cursors, and store per-user list state (columns, sort, density, grouping) server-side so it roams across devices.

## Module: portal

### Features
- **Search-first home** — One prominent search box with type-ahead that mixes knowledge articles, catalog items, open requests and people, plus an AI answer card with citations: [SN] AI Search Genius Results and Now Assist Q&A; [JSM] help-center search across request forms and articles, with Rovo answers. Popular items, categories and announcements sit below. [SN] [JSM]
- **Catalog and taxonomy** — [SN] Employee Center uses an employee-centric taxonomy (e.g. IT → Hardware → Printers, three levels) unifying IT, HR and facilities content. [JSM] has portal groups, hidden request types (searchable but not listed) and restricted request types (≤ 50 listed users, groups or organisations). [FS] offers a service catalog with dynamic sections and up to 50 portals (Pro). [SN] [JSM] [FS]
- **Conditional forms with deflection** — [JSM] Forms: 200+ templates; conditional show/hide (advanced logic 2026); validation (required, range, regex); data connections (REST → choice lists); Assets pickers. [SN] Catalog variables with UI policies, and *in-form ticket deflection* that suggests answers before submit (July 2026). Article suggestions appear while the user types the summary. [JSM] [SN] [AI]
- **My requests timeline** — [JSM] request detail shows status (custom help-seeker statuses, 2026), activity, approvals, participants and sharing, customer transitions (cancel, resolve, reopen), an SLA *support timeline* (Premium+) and linked status-page incidents. The *Requests* list covers mine, shared with me and my organisation, with filters. [SN] *My Items* consolidates work across departments; *My To-dos* has Open and Completed tabs. [JSM] [SN]
- **Approvals inbox** — Approve or decline from the portal, e-mail buttons, Slack/Teams DM or mobile; approvers need no licence ([JSM]). [SN] Approval Hub aggregates approvals and to-dos from ServiceNow *and other systems*; the Approval Assistance AI agent (Australia) summarises the request, checks policy and suggests a decision. [SN] [JSM] [AI]
- **Announcements and status** — [SN] Content Experiences (formerly Campaigns), a news editor with publishing flow (Pro), recurring campaigns, and major-incident announcements as a banner or portal widget. [JSM] help-center announcements and login messages, public status pages (Enterprise, Apr 2026) and private status pages (Jul 2026). [SN] [JSM]
- **Virtual agent and AI front door** — [SN] Virtual Agent topics plus ServiceNow Otto / EmployeeWorks (Moveworks-based) that "finishes the job" across systems. [JSM] Virtual service agent (intents + AI answers from KB with source links) in the portal, Slack or Teams, e-mail and widget, plus Rovo agents and live handoff. [FS] Freddy AI Agent (session-metered) and ServiceBot in Teams/Slack. [SN] [JSM] [FS] [AI]
- **Omnichannel intake** — Portal, e-mail (JSM: up to 10 addresses per space, mail-loop and DMARC checks), Slack/Teams chat, embeddable widget, voice and WhatsApp (JSM CSM), walk-up check-in ([SN] Walk-up Experience), mobile, API. [JSM] [SN]

### Implementation notes
- Unify portal search in one index (articles, catalog items, requests the user may see, people), with per-document ACL filters applied at query time. Log zero-result and abandoned searches for knowledge-gap analytics.
- Each catalog item declares a schema (fields, conditions, validations, data connections) rendered by a single form engine shared by portal, agent "raise on behalf" and the AI agent (slot-filling), so the virtual agent never needs separate form logic.

## Module: admin

### Features
- **Form and request-type designers** — Drag-and-drop field layout, sections and conditional visibility. Field properties: mandatory on submit/resolve, visible or editable by requester. [FS] Field Manager with dynamic sections; [JSM] request-type editor and Forms; [SN] form designer and UI Builder for workspace pages. [FS] [JSM] [SN]
- **Flow designers** — [SN] Flow Designer / Workflow Studio: triggers, actions, If/For Each/parallel/Try-Catch, decision tables, subflows, data pills, execution details, natural-language flow generation. [JSM] Automation *flows* (renamed April 2026): one trigger + conditions + actions + branches, scopes from a single space to global, actor, owner, error notifications, audit log and templates. [FS] Workflow Automator: a visual node canvas (event → condition → action, expressions, web requests, orchestration apps). [SN] [JSM] [FS]
- **Rule builders and SLA designers** — Condition builders with AND/OR groups, decision tables, assignment rules, and SLA definitions (start, pause, stop conditions; schedule; targets per priority; escalation and notification at 50/75/100%; JSM goals per JQL with calendars). [SN] [JSM] [FS]
- **Catalog builders** — [SN] Catalog Builder for non-admin catalog owners (templates; stages and advanced UI policies in Australia). [JSM] Request-type template library (IT, HR, facilities, finance, legal, …) plus AI "suggest request types/fields" (Premium+). [SN] [JSM] [AI]
- **Admin centres and guided setup** — [SN] SOW Admin Center (feature toggles, granular admin roles), guided setups, auto-install of SOW on new instances (Brazil). [JSM] Space templates per team type. [FS] onboarding checklists (unverified detail). [SN] [JSM]
- **Safe change** — Sandboxes ([FS] Enterprise; [JSM] Premium+ with release tracks; [SN] developer sandboxes since Zurich), update sets and versioned flows (draft vs published), and the Automated Test Framework with quick-start tests for ITSM. [SN] [JSM] [FS]
- **Branding and theming** — [SN] Theme Builder (light, dark, compact variants). [JSM] custom-branded help centers. [FS] up to 50 portals with custom SSL. [SN] [JSM] [FS]
- **Onboarding and empty states** — Every empty list, queue or dashboard shows one sentence, one primary action ("Create your first SLA") and a template gallery or sample data. Checklists track setup progress. Contextual "what's new" appears only where it applies. [pattern across tools]

### Implementation notes
- All designers should output declarative JSON (form schema, flow graph, rule AST, SLA definition) that is versioned, diffable and exportable, with a dry-run or test mode ("simulate this SLA on last month's tickets", "run this flow on record X") before publish.
- AI-assisted admin: the natural-language request is turned into a draft artefact (flow, form, queue, report) that the admin reviews in the same designer UI. Never apply it directly.

## Module: ai

### Features
- **AI surfaces in the agent UI** — (1) an AI summary card at the top of the record; (2) inline composer actions (draft, improve, translate); (3) a side panel for Q&A and investigation ([SN] Now Assist panel, [FS] Freddy panel); (4) natural language in lists, queues and reports ([JSM] `/manage-queue`; Ask Freddy, Ask Zia, Insight Finder); (5) chat front doors (Otto/EmployeeWorks, VSA, Freddy AI Agent); (6) AI in Slack/Teams. [SN] [JSM] [FS] [ME] [BMC] [AI]
- **Visible agentic progress** — The [SN] contextual side panel has an *Agentic processes* tab showing the progress and results of AI workflows on the record. *Incident Analyzer* (Oct 2026) investigates new P1/P2 incidents and writes a summary to work notes. [JSM] ICC shows hypotheses with confidence and evidence. [SN] [JSM] [AI]
- **Trust and control patterns** — Citations and links to sources, confidence levels ([ME] SLA-breach prediction with confidence levels, Nov 2026; [JSM] ICC hypotheses High/Medium/Low), human approval before AI executes actions ([FS] next-best actions, Oct 2026), "AI-generated" labels and audit, thumbs feedback, edit-before-send, and governance consoles ([SN] AI Control Tower). [ME] [JSM] [FS] [SN] [AI]
- **Measuring AI value** — [BMC] Service Collaborator Value Dashboard: MTTR, response time and SLA adherence for AI-assisted vs non-assisted tickets. [FS] Freddy AI Copilot reports. [SN] AI Agent Studio performance dashboards. Metered credits (Rovo credits, Now Assist assists, Freddy sessions) need usage dashboards. [BMC] [FS] [SN] [JSM] [AI]

### Implementation notes
- Every AI artefact (summary, draft, classification, insight) gets a row with inputs reference, model, prompt version, output, user decision (accepted/edited/rejected) and latency. This powers value dashboards, audits and prompt regression tests.
- AI calls execute with the requesting user's permissions (retrieval filtered by ACL before the model sees data). Background agents run as a service identity with an explicit, reviewable scope.

## Access control & org structure
- **Report and dashboard permissions.**
  - [FS]: reports are private by default and shared with view, edit or manage rights. Only agents whose role has "view analytics" with *global* scope can use Analytics. Only user fields visible to "All admins" sync to analytics, so field-level restrictions carry over.
  - [SN]: dashboards are shared to users, groups and roles as owner, editor or viewer. Reports and lists respect table and field ACLs. Analytics roles include pa_admin, pa_power_user, pa_viewer, report_admin, report_global, report_group, report_publisher and report_scheduler (exact role names partly unverified). Domain separation scopes data per tenant.
  - [JSM] Insights: data-source and dashboard permissions. Data Lake connections are *permission-enforced* (default) or *unpermissioned*. Enterprise *data shares* to external BI do **not** enforce Atlassian permissions, a governance gap to avoid.
  - [BMC] Dashboards honour ITSM permissions and 26.3 adds monitoring of dashboard permissions. [ME] filters survey reports by user role (Feb 2026), and report folders are shared selectively.
- **Org structure that analytics must respect.**
  - [SN]: assignment groups, companies, domains.
  - [JSM]: spaces, teams, customers and organisations.
  - [FS]: ESM workspaces with workspace-scoped roles.
  - [ME]: sites and up to 50 service-desk instances.
  - [BMC]: multi-company tenancy.
  - Every KPI needs the same scoping as the record it counts (e.g. a group manager sees only their groups' MTTR; the owner sees all).
- **How AI respects permissions.**
  - [SN] Now Assist/Otto runs in the user's context. AI Data Explorer refused unsupported protected scopes (Zurich Patch 10) until Australia Patch 1 added governed support. AI Control Tower governs agents.
  - [JSM]: anyone with incident access can view ICC AI outputs, but only the assignee, responders or Incident Manager can trigger investigations or edit plans. VSA AI answers respect customer KB permissions, except in Slack, where only "All logged-in users" spaces are used. Rovo answers in Insights are SQL-backed over permission-enforced connections.
  - Recommendation: one policy decision point shared by lists, reports, NL queries and RAG retrieval, with row-level security applied *before* data reaches a model. Log `on_behalf_of` for every AI query.
- **Delegation.** Approval delegates with date ranges ([SN] sys_user_delegate), transfer of report and dashboard ownership when people leave, and scheduled-report recipients re-checked against permissions at send time (a common leak if not done).

## AI capabilities
- **NL → visualization/dashboard** [SN] — Query Generation turns a question into a query over tables or indicators, renders a visualization, suggests follow-ups, and exports PDF from the Now Assist/Otto panel.
- **AI Data Explorer** [SN] — conversational exploration launched from any list or visualization; Australia Patch 1 added governed protected-scope support.
- **KPI Signals and proactive insights** [SN] — 3-sigma process-behaviour rules (outliers, short and long runs, anti-signals) plus key-contributor and threshold events, shown as dashboard insight cards.
- **Rovo in Insights** [JSM] — NL questions answered with SQL-backed results, AI-written formulas, AI-generated SQL, and chart insights that describe trends and anomalies.
- **Rovo `/manage-queue` and request-type/field suggestions** [JSM] — natural language → JQL queue definition and columns; AI proposes request types and fields.
- **Ask Freddy** [FS] — NLP question → analytics widget, with recent and suggested queries.
- **Freddy AI Insights** [FS] — proactive cards on SLA violations, trends and root-cause trees.
- **Freddy Copilot reports** [FS] — usage and impact reporting for AI assistance.
- **HelixGPT Insight Finder** [BMC] — NL prompt → Grafana dashboards and panels over ITSM, AIOps and vulnerability data, with multilingual PDF export.
- **ITSM Insights proactive problem management** [BMC] — clusters incidents into candidate problems with an Advanced Analytics dashboard.
- **AI value dashboards** [BMC] — compare MTTR, response time and SLA adherence of AI-assisted vs non-assisted tickets.
- **Ask Zia, Zia Insights, Analytics Charts in Ask Zia** [ME] — voice or text question → report or chart; auto-written narratives of charts.
- **Zia SLA-breach prediction** [ME] — predicts breaches with confidence levels on request details (Nov 2026).
- **Halo AI report creators, summaries, forecasting** [Halo] — prompt-defined insights added to reports; AI report summaries with next-step recommendations; QBR packs; forecasting.
- **Record GenAI** [SN] [FS] [JSM] [ZD] — summaries, resolution notes, KB drafts, reply and e-mail drafts, writing improvement and translation, sentiment, field autofill, similar tickets, suggested macros (Copilot auto assist).
- **Incident assist agentic workflow** [SN] — conversational investigation across caller assets, similar incidents, SLA risk, changes, outages, CIs and on-call experts.
- **Incident Analyzer** [SN] — auto-investigates new P1/P2 incidents and writes findings to work notes.
- **Agentic processes tab** [SN] — shows the progress and results of AI workflows on a record.
- **Incident Command Center** [JSM] — AI overview, hypotheses with confidence and evidence, telemetry, mitigation plans, communication drafts and compiled PIR.
- **AI incident summaries and timelines in Slack** [JSM] — a private catch-up for late joiners and an auto-compiled timeline after resolution.
- **Change risk insights / Prevention Center** [JSM] — AI change summary, pre-risk assessment from history, conflicts and freeze windows.
- **Change Success Score** [SN] — historical-outcome scoring that feeds approval policy (statistical, not GenAI).
- **In-form deflection and AI ticket suggestions** [SN] — suggests answers before the portal form is submitted.
- **Approval Assistance agent** [SN] — gathers request details, checks policy and suggests approve or decline.
- **AI routing** [SN] [JSM] — routing-mode selector for reassignment; Request Router assigns and prioritises.
- **Virtual agents and front doors** [SN] [JSM] [FS] — Otto/EmployeeWorks, JSM VSA (intents + generative KB answers), Freddy AI Agent; all execute workflows, not only answer.
- **Alert AI** [JSM] — AI alert grouping and signal-vs-noise classification feeding noise-reduction KPIs.
- **HAM insights** [JSM] — expiring warranty, low stock, dormant and incident-prone assets, from deterministic queries phrased by AI.
- **PIR generation** [FS] [JSM] [SN] — PIR drafted from the incident timeline, comms and actions.
- **Next-best actions with approval** [FS] — suggested actions executed in-ticket after human confirmation.
- **Workforce forecasting** [JSM] [SN] — volume forecasts feeding schedules and capacity.

## Differentiators
**What each leader does best**
- [SN] The most complete governed metric engine: indicators, breakdowns, snapshots with drill-back, targets and thresholds, KPI Signals, explainable Spotlight scoring, Benchmarks, Process Mining. Single-pane SOW with contextual side panel, Major Incident Workbench and CAB Workbench. Agentic AI visible on the record. Best accessibility preferences (patterns instead of colour, reduced motion, 400% reflow).
- [JSM] Visual SQL with AI SQL and formulas, 16 chart types and the Data Lake. JQL-powered queues anyone can define, including by natural language. Change calendar with iCal for unlicensed staff and a risk-insights panel. ICC with live telemetry. Slack/Teams-native swarming.
- [FS] Fastest report authoring (≈ 5 clicks, widget gallery, quick-edit panel), presentation mode, Ask Freddy, simple curated reports. Collision detection, and a PIR widget with an AI generator.
- [BMC] Grafana-grade cross-source dashboards (even over ServiceNow data), deleted-dashboard recovery, Arabic RTL, and AI value dashboards.
- [ME] The richest classic report types (Matrix, Audit, CI history, SQL query reports), on-prem analytics, Ask Zia charts, and confidence-scored breach prediction.
- [Halo] Unlimited dashboards, chart-embedding PDF templates, QBR packs, AI report creators. [ZD] Contextual workspace, side conversations and "/" macros in the composer.

**How a Persian RTL enterprise app with AI everywhere can surpass them**
1. **RTL-native everywhere.** No leader is fully RTL (Jira Cloud has none; ServiceNow relies on language plugins; BMC dashboards added Arabic only in 26.3). Mirror layouts, charts and calendars; use bidi-safe editors and Persian digits.
2. **Jalali in the core.** Jalali dates in SLAs, schedules, KPI periods and fiscal years. Official Iranian holidays, including the shifting lunar dates, as SLA exclusions and change-blackout templates.
3. **Persian language services.** Persian search normalisation (ي/ی, ك/ک, ZWNJ, diacritics, Persian/Arabic digits). Persian NLP for routing and deflection. AI drafts with formal/informal tone control and Persian↔English translation.
4. **One certified metric layer.** The KPI catalogue above ships ready-made (formula, clock, target, owner). It feeds lists, SLAs, dashboards and AI answers, so a number is identical everywhere.
5. **"Explain this number" on every tile.** Drill to live records *and* the historical snapshot, statistical signal flags (KPI-Signals-style), top contributors, and an AI narrative with a link to the definition.
6. **ACL-true AI analyst.** NL → semantic query (never raw SQL), executed as the user, with the definition shown. The answer is an editable, schedulable, alertable widget, and data exports keep row-level security (closing JSM's data-share gap).
7. **Agent cockpit.** A header with SLA chips, an AI summary card, a composer with a public/internal safety toggle and "/" templates, Ctrl+K for navigation, records, actions and AI, live collision, and next-best actions with one-click approval.
8. **Self-contained war room.** Roles (commander, comms, scribe), an update-cadence timer, status page, auto-captured timeline and AI PIR. It works without Slack/Teams and integrates with local messengers and SMS gateways where needed.
9. **Change calendar and CAB workbench.** CI-graph conflict detection, holiday-aware blackout windows, lockdown mode, and live CAB voting with minutes drafted by AI.
10. **Measured AI.** AI-assisted vs unassisted cohort dashboards, acceptance rates, cost and credit governance, and an audit row for every AI artefact.
11. **Persian XLA.** XLA and experience analytics built in: Persian CSAT/CES/NPS micro-surveys with AI theme extraction, combined with SLA, DEX and lost-time indicators.
12. **WCAG 2.2 AA tested in RTL.** Persian screen-reader runs, drag alternatives, 24 px targets, three densities and dark mode. Empty states teach with templates rather than paragraphs.
