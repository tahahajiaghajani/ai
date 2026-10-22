# Market research — Pars Project Management (AI-native EPM) · Oct 2026

> Sources were collected via web search on 2026-10-22. Iranian (.ir) sites were not reachable from the research environment, so local-vendor claims are from third-party pages.

## 1. Market size & CAGR

| Segment | Estimates | Spread |
|---|---|---|
| **PPM software** | MarketsandMarkets: $8.64B (2025) → $17.75B (2031), 12.6% CAGR ([PR](https://www.webull.com/news/15418540783518720)); Grand View: $5.7B (2024) → $12.3B (2030), 14.2% ([GVR](https://www.grandviewresearch.com/industry-analysis/project-portfolio-management-ppm-market)); IMARC: $7.4B (2025), 7.99% CAGR 2026–34 ([IMARC](https://www.imarcgroup.com/project-portfolio-management-market)) | base $5–9B; CAGR 8–14% |
| **AI in project management** | ResearchAndMarkets: $5.32B (2025) → $14.14B (2030), 21.8% ([GNW](https://www.globenewswire.com/de/news-release/2025/10/01/3159806/0/en/AI-in-Project-Management-Market-Outlook-2025-2030-Revenues-to-Grow-from-5-32-Billion-to-14-14-Billion.html)); Technavio: 16.8% CAGR 2024–29 ([Technavio](https://www.technavio.com/report/ai-in-project-management-market-industry-analysis)) | CAGR 13–22% |
| **Agentic AI / AI agents** | MarketsandMarkets: $7.06B (2025) → $93.2B (2032), 44.6% ([MnM](https://www.marketsandmarkets.com/PressReleases/agentic-ai.asp)); Grand View: $50.31B by 2030, 45.8% ([PRN](https://www.prnewswire.co.uk/news-releases/ai-agents-market-size-to-hit-50-31-billion-by-2030-at-cagr-45-8---grand-view-research-inc-302447061.html)); Gartner: agentic AI ≈30% of enterprise app software revenue (>$450B) by 2035 ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025)) | CAGR 42–47% |
| **RAG** | MarketsandMarkets: $1.94B (2025) → $9.86B (2030), 38.4% ([MnM](https://www.marketsandmarkets.com/Market-Reports/retrieval-augmented-generation-rag-market-135976317.html)) | CAGR 38–45% |
| **Enterprise search** | IMARC: $6.1B (2024) → $14.0B (2033), 9.1% ([IMARC](https://imarcgroup.com/global-enterprise-search-market)) | CAGR 8–10.5% |

**Takeaway:** PPM is a mature ~8–14% category; the ~40% growth lives in the AI layer (agents, RAG). Sell *AI on top of PPM*, not "another PPM tool".

## 2. Trend signals
- Gartner (2019): "by 2030, 80% of the work of today's PM discipline will be eliminated" as AI takes over data collection, tracking and reporting ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2019-03-20-gartner-says-80-percent-of-today-s-project-management)).
- Gartner (2025): 40% of enterprise apps will feature task-specific agents by end-2026 (from <5% in 2025); >40% of agentic AI projects will be cancelled by end-2027 — warns against "agent washing" ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)).
- PMI: only 21% use AI "always/often" while 82% of senior leaders expect AI to affect projects ([PMI](https://www.pmi.org/about/press-media/press-releases/pmi-introduces-pmi-infinity-the-all-new-ai-powered-resource-for-project-professionals)); 49% have little or no practical AI experience ([PMI](https://www.pmi.org/about/press-media/press-releases/demand-increases-for-project-professionals-with-ai-skills)).
- **Microsoft:** Project Online — no new licences from 2025-10-01, retirement **2026-09-30** ([MC1148537](https://mc.merill.net/message/MC1148537)); **Project Server 2016/2019 extended support ended 2026-07-14** ([Lansweeper](https://www.lansweeper.com/blog/eol/microsoft-project-and-project-server-end-of-life/)). Microsoft's AI for project work is cloud-only (Planner Agent in M365 Copilot) → unreachable for Iranian banks.
- Agentic AI in banking: 16% of banks deployed, 52% piloting (MIT TR Insights/EY via [Financial Brand](https://thefinancialbrand.com/news/artificial-intelligence-banking/bankings-agentic-ai-revolution-how-70-of-institutions-are-already-transforming-operations-192250)); only 10% of FS firms run agents at scale ([Capgemini](https://www.capgemini.com/news/press-releases/banks-and-insurers-deploy-ai-agents-to-fight-fraud-and-process-applications-with-plans-for-new-roles-to-supervise-the-ai)).

## 3. Competitive landscape
- Global: Planview Anvi (agents + MCP, Gartner SPM Leader), Oracle Primavera Unifier AI, ServiceNow SPM Now Assist, Atlassian Rovo, monday agents, Smartsheet Smart Agents, Asana AI Studio — all cloud-first, US-hosted, English-first; effectively off-limits for Iranian banks under sanctions.
- Iran: Hamkaran System (ERP-centric), Rayvarz (ERP/DMS/HR), Chargoon (office automation), BPMS vendors (ShAuto, Pegah Aftab), Mizito (team tasks). **No Iranian vendor is positioned as AI-native enterprise portfolio management for banks.**
- Regional template: Saudi MasterTeam P+ with FARIS AI, in-country hosted, 60–70 government entities.

## 4. White space & positioning
- Forced migration: unsupported Project Server 2016/2019 + retired Project Online → Pars' 15 years of Project Server/P6 data-model knowledge is a moat.
- Connectivity risk (2026 shutdowns) → on-prem / air-gapped agents on local Persian LLMs are a requirement, not a nice-to-have.
- Cyber risk (Bank Sepah wipe, 2025) → hardened on-prem systems with audit trails.
- Policy tailwind: National AI Document (2024); Bank Mellat × University of Tehran AI institute (2025).

**Five positioning statements**
1. "The EPM that keeps working when the internet doesn't" — on-prem, air-gapped agents on local Persian LLMs.
2. "Your Microsoft exit path, with 15 years of data intact."
3. "Agents that do the PMO's work, not just chat."
4. "Bank-grade AI where every agent action is audited."
5. "Persian-first portfolio intelligence" — RAG over Persian letters/contracts/minutes, Jalali-aware predictions.
