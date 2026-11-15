# Kariz — roadmap to the next version (1.2)

What «کاریز» (Kariz) still needs to become its best and most complete version: performance, speed, the job queue, infrastructure, security, design and features. Written on 15 Nov 2026 from five research passes and a critic's review (workflow wf_c9703374-224) and checked against `origin/main` at f2d9230 and the open patch PR #53. Paths are relative to `itsm/` unless they start with `.github/`.

> **Update, 15 Nov 2026, 14:30 UTC.** Kariz 1.1.1 is on `main` (tahahajiaghajani/ai#53, merge 3954abb) and released as `itsm-v1.1.1`: `Kariz-Setup-1.1.1.exe` (130,334,561 bytes, sha256 `5e36e555ab06aab480a1384e8324bfe6bde72e5759bdd2d29e843da07207b30b`) and `Kariz-Server-1.1.1.msi` (74,990,386 bytes, sha256 `42e50bb19ff59e26f237d896b1c8fcff7a2ec345ee5457cebc711c03b59e35ae`). It fixed the endless CI health re-check loop in every edition (`docs/PERFORMANCE_FA.md` §20) and dropped the first-start file warm-up; the first-page wait of run 43696253020 is still unexplained (§17). Where an item below calls PR #53 open, it is merged. INFRA-1 still stands: a merge under `itsm/**` without a version bump rebuilds and replaces `itsm-v1.1.1`. The 1.1.1 stall log gave the first evidence for the first-page wait: in desktop-e2e runs 43715791761 and 43721515570 the local server's thread was held 1.0–2.2 s at a time, 10 and 8 times in the first three minutes after setup while the demo pack loaded (15.9 s and 11.8 s in all), with `GET /api/o/:id/demo` and `GET /api/local/sync` waiting. Next: name the running job in that log line, then split the long synchronous statements of the seeding and demo jobs (top priority for the Windows app).


## How to use this document

**Where things are**
- Code: `itsm/` on `main`. The unmerged redesign branches are `rd-base` (the P0 kit and the Q tooling, 111 commits), `rd-p0` and `rd-q`.
- Redesign plan: `itsm/docs/qa/redesign/C2-{INVENTORY,SPEC,PACKAGES,QA}.md` on `rd-base`. Design F (forms and workflows), design A (asset integrations), the stage-B unit list, the golden screenshots and the 60 vision findings are only in the session scratchpad and the journals. DOC-1 and UX-2 move them into git.
- Evidence sources:
  - docs under `itsm/docs/`: RELEASE_FA, PERFORMANCE_FA, qa/PERFORMANCE_E2E_FA, SERVER_FA, BANK_INSTALL_FA, qa/BANK_SIM_FA, qa/CLICKTHROUGH, DEMO_FA, FEATURES_FA, AI_FA, modules/*;
  - the orchestrator's log `PLAN.md` (scratchpad);
  - the reports of the research passes behind this document (session journals; not kept in the repository).
- CI: `.github/workflows/itsm.yml`, with the jobs check, test 1–4, clickthrough, windows, server, desktop-e2e, server-publish and bank-sim.

**How to pick work**
1. Do M0 first (see the plan below). **Land INFRA-1, or bump the version, before anything else under `itsm/**` reaches `main`.** Until INFRA-1 lands, every such merge with an unchanged version replaces the official release's binaries.
2. Then go milestone by milestone. Inside a milestone, take the highest priority whose «Depends on» is done. The design packages (M3) own UI files, so they can run beside M1 and M2. Keep at most 4 heavy units running at once on the 4-vCPU machine.
3. Before starting an item, re-check its evidence on `origin/main` (`git show origin/main:itsm/<path>`). Neighbouring work often fixes leftovers.
4. «Done when» is the item's acceptance. Every fix gets a test that fails without it, and concurrency fixes get real-PostgreSQL tests.
5. Follow the owner's working rules:
   - one push every two hours at most;
   - "flake" is never a root cause;
   - never skip or loosen a test or a budget.

   User-visible changes get a «تازه‌ها» line (`src/server/modules/admin/changelog.ts`) and a RELEASE_FA entry.

**How to mark items done**
- Every item's header line ends with `status: open`. Change it to one of:
  - `status: done — <commit> (CI run <id>)`;
  - `status: partly done — <what remains>`;
  - `status: dropped — <reason or owner decision>`.

  Make the same change in "Top priorities".
- An item split into parts (QA-2a and QA-2b, SEC-5a and SEC-5b, SEC-7a and SEC-7b, INFRA-3a and INFRA-3b) gives each part's priority in its header and marks each part on its own, for example `status: a done — <commit> (CI run <id>); b open`.
- Never renumber or delete an item. A new item takes the next free number of its area and goes at the end of that area. A new P0 or P1 also goes into "Top priorities" and into the plan.

## State at the start (15 Nov 2026, 11:00 UTC)

- **1.1 final is on `main`.** PR #45 merged as 2a5d27a and PR #48 as f2d9230 at 08:48 UTC. `APP_VERSION` is 1.1.0 and `SYNC_PROTOCOL` is 17.
- **Release `itsm-v1.1.0`** targets f2d9230, was published at 09:16:26 UTC and is not immutable. Its files:
  - `Kariz-Setup-1.1.0.exe`: 130,329,591 bytes, sha256 `0c8f9ef339bbdef42800348c3a64cf05ce4c5d820a434d3a26b1178e8a0c39bb`;
  - `Kariz-Server-1.1.0.msi`: 74,998,578 bytes, sha256 `73374f08ff835b3ded77af17ebbb2e22b6bd8a48ed3014b6e36a829a2a1433a5`.
- **Main run 43696253020 ("run 117"):**
  - Attempt 1 was green except desktop-e2e. That job (132764044988) ended at 09:26 UTC, ten minutes after the release had been published: «admin: API as the renderer saw it, 95th percentile (ms): 2766 (budget 2000)».
  - Attempt 2 re-ran only desktop-e2e (job 132781870599) and passed 67/67 at 10:39 UTC, with the admin p95 at 746 ms.
- **Open patch PR #53** (draft; 1.1.1; head aca00f2; CI run 43705829804 running at writing) is the root-cause fix for that run:
  - `settleFiles` opens every unpacked template file once, before PGlite does;
  - a stall watch (`src/desktop/stall.ts`) logs when the thread is held;
  - the version is bumped to 1.1.1.

  The roadmap doc is planned on the same branch.
- **What 1.1 contains:**
  1. All ITSM/ESM modules: incident, problem, change, request and catalogue, knowledge, CMDB, ITAM, SLM/XLA, workforce, portal, ESM/CSM/field service, events, continuity/GRC, release/DevOps/projects, finance and analytics. They come with an access-aware AI layer: RAG, the assistant and agents.
  2. Admin-built fields, forms, organisational roles and form-based workflows, with the user's «گردش‌کارها» page.
  3. Asset and status intake from Zabbix, PRTG, vCenter, REST, the push API and CSV/JSON feeds, with «صف آشتی» and «وضعیت پایش». Sign-in through AD and SSO.
  4. Three editions from one codebase:
     - web (Vercel + Supabase);
     - Windows app (Electron + PGlite, two-way sync, no per-organisation write lock since D4);
     - air-gapped Server Edition (MSI, services `KarizApp` and `KarizDB`, `karizctl`).

     The bank demo pack loads with one click and purges with zero trace.
  5. CI with the bank intranet simulation (bank-sim) and the installed-app end-to-end test (desktop-e2e), plus the performance work of 1.1.

## The queue today

**Verdict.** Kariz has a solid, durable PostgreSQL job queue: a transactional outbox with `FOR UPDATE SKIP LOCKED` claims.
- What it already does: at-least-once delivery, retries with backoff, dedupe, time budgets, resumable steps, leader election and a yield to people's requests, all well covered by tests. It carries today's sizes.
- What it lacks: it is not yet the scalable, observable scheduler a large bank's peak needs. One leader runs four jobs per round in a global FIFO, with no priorities, no per-organisation fairness, fixed unfenced leases, no keeper for recurring chains and no alerting.

**Storage and enqueue**
- **One table, `sm_jobs`** (`src/server/db/migrations/0005_engine.ts:32-54`).
  - Columns: uuidv7 id, org_id, kind, jsonb payload, status (queued/running/done/failed), run_at, attempts, max_attempts (default 8; record events 10), locked_by, locked_until, dedupe_key, last_error (≤ 2,000 characters) and timestamps.
  - Partial indexes: due (run_at, where queued), running (locked_until), finished (done_at) and failed (org_id, done_at; added in 0103).
  - Other indexes: (org_id, created_at desc) and a unique (org, dedupe_key) where queued.
- **Writes queue in their own transaction.** A job that follows a write is inserted in the writer's transaction, so a record event exists exactly when its write commits. `enqueueMany` is one set-based insert.
- **About 155 job handlers** are registered across the modules. `record.*` events go to `onRecordEvent` subscribers in order, and a retry skips the subscribers that already succeeded.
- **Dedupe:**
  - while a job with the same (org, key) is queued, enqueue returns that twin;
  - a running job asked to run again folds into a twin queued meanwhile;
  - nothing stops a twin from running beside a running job.

**Claiming**
- **One statement claims** (`src/server/jobs/index.ts:172-184`): `update … where id in (select … where status='queued' and run_at<=now() order by run_at, id limit n for update skip locked)`. It sets running, increments attempts and sets a fixed 5-minute lease and locked_by.
- **Expired leases** (a dead worker's jobs) are taken only when nothing is due.
- **Order** is a global FIFO by run_at. There is no priority column, no lane, and no per-organisation or per-kind share or limit.
- **Per-record order:** events of one record claimed in the same batch run one after another, and one tick per process runs at a time. Order therefore holds inside one process but not across processes: several web instances, or the console's «اجرا اکنون» on another worker.
- **Modules that need exclusion** use their own leases: notify flush 4 min, AI thread runs 5 min, discovery feed claims.

**Runners by edition**

| Edition | Who runs jobs | Width and budget | When it runs |
|---|---|---|---|
| Server | Only the leader (`pg_try_advisory_lock(724150)` on a reserved connection, re-checked in `pg_locks` before each tick; followers retry every 5–6 s). The leader also serves HTTP on the same pool and event loop and runs the backup chore. | Rounds of up to 4 jobs (`JOB_CONCURRENCY`, a code constant); each round waits for its slowest job; 20 s budget | Again at once while work is due, else every `scheduler.interval_s` (5 s; 1–300). Writes under `/o/:org` that queued jobs wake it through NOTIFY `itsm_tick` (at most every 250 ms per worker, coalesced over 50 ms). |
| Windows app | The local server, on PGlite's single connection | One job at a time; 8 s budget | Every 10 s; no wake after a write. PGlite gives the event loop a turn every 50 ms of database work. `stopTicks` finishes held jobs when the app closes. |
| Web | No worker. After each write under `/o/:org` that queued jobs, `after()` runs a tick; `/api/cron/tick` also runs one. Several instances may tick at once. | Both ticks run one job at a time. After-write tick: 4 s, its result ignored. Cron tick: 20 s inside a 60 s function. | The cron runs every minute only when the owner sets up Supabase pg_cron + pg_net; otherwise Vercel cron calls it once a day (`17 4 * * *`). |

**Yielding to people.** Before each round the runner waits up to `YIELD_MS` (250 ms) while a person waits for an answer.
- Server: signed-in browser requests on any worker count (session cookie, no Authorization header, not background). Counting starts before the session lookup, each worker stays busy 300 ms after its last request, and the supervisor combines the workers.
- Windows: the window's own requests count from their first byte, and so do signed-in office-network browsers.
- Never counted: device-token sync, monitoring probes and anonymous requests. The web edition does not yield.

**Retries, failures, retention**
- Backoff is 15 s × 2^(n−1), capped at 1 h, with 0–20% jitter.
- Deadlocks and serialisation failures are rerun in-process (up to 4 runs) from the stored payload, without spending an attempt.
- `PermanentJobError` fails a job at once. A handler that returns `{ again: ms }` is re-queued without spending an attempt.
- After max_attempts a job stays failed with its last_error; that is the dead letter.
- Done jobs are kept 3 days and failed jobs 30 days. Cleanup runs hourly per process, in 5,000-row batches, inside the tick budget.

**Budgets and resumable steps.** Handlers receive `jctx.deadline` and return `{ again: 0 }` to continue on the next tick. `save` stores progress; `saveIn` stores it inside the handler's own transaction, so a crash after the commit skips work already done. Users: notify.batch (100 recipients per transaction), the demo loader (40 records per transaction), the discovery cursors, the RAG indexer and the agents. Nothing enforces the deadline or times a handler out.

**Recurring work**
- Delays use run_at or delayMs.
- Recurring work is self-re-arming jobs. They are started by org seeds (when an organisation is created or a module switched on) or by each module's `ensure*()` with dedupe keys; there are about 20 per-org sweeps and ticks.
- Scheduled flows and recurring records use one `flows.scheduler` job per organisation every minute. Occurrences missed while the server was down are not replayed.
- There is no generic cron registry; backups are leader chores, not jobs.

**Crash recovery**
- A dead worker's job is taken again after its 5-minute lease, but only once nothing else is due, and an attempt is counted.
- Subscribers already done and saved progress are skipped.
- Crashed workers restart with a 1 s to 60 s backoff.
- Leases are never renewed and outcomes are not fenced. A job that kills its process is re-run with no attempt limit.

**Observability**
- «سلامت سرور» shows due, scheduled, running and failed-in-24 h counts, the oldest due job's age, the top 5 due kinds, and each worker's last tick (time, ran, failed, ms) and leader flag.
- Its scheduler check is ok whenever a leader exists. Its jobs check warns when anything failed in 24 h, else when the oldest due job waited more than 300 s; it never shows danger.
- Prometheus (bearer metrics_token) exports only `itsm_jobs_due`, `itsm_jobs_running`, `itsm_jobs_failed_24h` and `itsm_scheduler_leader`.
- The platform and organisation consoles show:
  - per-kind queued, running, failed and done counts, with the oldest due, backlog seconds and failed in 24 h;
  - a job list (≤ 500, filtered);
  - per-job retry and cancel, with audit;
  - «اجرا اکنون» (a 5 s tick).
- No alert is pushed, and karizctl has no jobs command.

**Measured**

| What | Number | Source |
|---|---|---|
| Backlog right after the medium demo pack (CI, Windows runner) | 7,361 and 10,130 jobs | PERFORMANCE_FA §19 (runs 43552521943, 43579650724) |
| Same, local 4-core server edition | 40,000 → 28,000 while draining | PERFORMANCE_FA §19 |
| Drain on CI at the end of the demo load | ≈ 72 jobs/s; ≈ 100 jobs/s in run 43601841272 | PERFORMANCE_FA §19 («علت» and the run 43601841272 paragraph) |
| Local 4-core server under constant browser use | 18 jobs/s without the yield, 7.9 jobs/s with it (page 328 vs 332 ms) | PERFORMANCE_FA §19 |
| In-process, tiny jobs | 586 and 582 jobs/s; 120 and 17 jobs/s with the old counting rule, the gate busy in 72% and 99% of looks (5 and 15 req/s) | PERFORMANCE_FA §19 |
| Demo pack «متوسط» load (4-vCPU runner) | 944 s (bank-sim); 1,086–1,646 s depending on the CPU | BANK_SIM_FA scenario 7; PERFORMANCE_FA §19 |
| Demo purge waiting behind the queue | 209.7 s → 316.7 s with the yield | PERFORMANCE_FA §19 |
| Load test, 150 users, 2 min: jobs left at the end | 11,661 → 1,424 after notifications were batched | PERFORMANCE_FA §13 |
| First-run setup: seed jobs ahead of a new incident's events | 1,000–1,900 (the real-PostgreSQL test allows 240 s) | `tests/server-edition-pg.test.ts:121-136` |
| Windows: workflow «ارسال» to the case at its next step | 8,858 and 8,907 ms (budget 45 s), mostly the 10 s tick | PERFORMANCE_E2E_FA §1-5 (run 43676017496); journal wf_80b85438-f3e |
| Console per-kind summary, 150,000 kept jobs | 99 ms | PERFORMANCE_E2E_FA §2-8 |

**Limits, and where they are handled**

| Limit | Item |
|---|---|
| One leader, four jobs per round, and every round waits for its slowest job; adding workers or cores adds no job capacity | Q-3 |
| A global FIFO with no priority, no lane and no per-organisation or per-kind share; SLA timers fire late by the drain time | Q-2 |
| A fixed, never-renewed lease; expired leases reclaimed only when nothing is due; poison jobs loop; late outcomes unfenced; handlers unbounded | Q-1 |
| The yield waits on any presence, not on pressure, and halves drain under constant use | Q-4 |
| `/sync`, `/v1` and `/hooks` never wake the runner; the Windows app has no wake at all; timers can be up to an interval late | Q-5 |
| The scheduler check is "ok" whenever a leader exists; Prometheus has four gauges; no alerts; no karizctl jobs command | Q-6, INFRA-3a, Q-8 |
| A recurring chain dies once its failures over its whole life reach max_attempts (admin.sweep: exports never expire; security.sweep: the regulatory clocks stop) | Q-7 |
| Web: one job per tick, and the per-minute heartbeat is optional and unwatched | Q-9 |
| Two-server layout: a dead backend can hold the leader lock until TCP keepalive notices (Windows default 2 h) | Q-10 |

## Top priorities

Every P0 item and the P1 items that unblock the most, in the order to take them.

1. INFRA-1 — Publish only after every gate, read both installers back, and never re-create an official release on a later main push (P0, S). Do it before the next merge under `itsm/**` that does not bump the version.
2. SEC-1 — Every member can read the organisation's audit log and support sessions; port rd-base's gate (P0, S).
3. SEC-2 — Tenant regexes in catalogue questions and event rules can pin a server worker (ReDoS) (P0, S).
4. Q-1 — Safe leases: reclaim under backlog, stop poison jobs, fence late outcomes, bound handlers (P0, M). First in M1.
5. SEC-6 — Web deployment safety: Preview deployments can migrate the production database; an unauthenticated public-API route (P0 for web, S).
6. SEC-5a — Bump @hono/node-server past the backslash path advisory (P0, S).
7. Q-7 — Keep every recurring chain alive (security.sweep's regulatory clocks, admin.sweep's export expiry); the export download guard ships in M0 (P0, M).
8. QA-1 — Confirm 1.1.1's fix for run 117 with stall-watch evidence, and re-base the budgets on multi-run medians (P1, M).
9. DOC-1 — Commit the F and A designs and the stage-B unit list before the scratchpad is lost (P1, S).
10. FEAT-2 — ITAM's software sync reads a capped share of the runs_on relationships and deactivates the rest (P0, S).
11. SEC-8 — Verified access-control gaps in workflows, monitoring and member invitations (P0, M).
12. QA-2a — The data-integrity races since D4: the last administrator, duplicate relationships, field_def, the push lock order (P0, M).
13. SEC-7a — MFA for platform, tenant, setup and breakglass accounts (P0, M; owner: default policy).
14. INFRA-3a — The alert channel: backup-failure and disk alerts in the Event Log and the metrics (P0, S).
15. SEC-3 — Code-sign the EXE, the MSI, the PowerShell scripts and karizctl (P0, M; owner: certificate).
16. SEC-4 — Independent penetration test (P0, L; owner: vendor). Contract it now; it tests the M1 build.
17. PERF-2 — Measure the published sizing on bank-like Windows hardware and data (P0, L; owner: lab).
18. INFRA-2 — Point-in-time recovery: WAL archiving and an RPO of minutes (P0, L).
19. PERF-1 — Bound the RAG cost behind «رخدادهای مشابه» at bank volume (P0, L).
20. Q-2 — Priority lanes and per-organisation fairness, so SLA timers never wait behind bulk work (P1, M).
21. DOC-4 — Recount the feature catalogue's statuses to 1.1; FEAT-19 plans from it (P1, M).
22. FEAT-19 — Close the feature catalogue's open P0 capabilities, module by module (P1, XL; owner: scope).
23. FEAT-1 — Record pages honour 1.1's form-hidden fields, primary and blocked transitions, and agents' offline definitions (P1, M).
24. UX-1 — Merge the P0 kit and the Q tooling (rd-base) into main in one reviewed merge (P1, L).
25. SEC-12 — Tamper-evident audit and security logs, forwarded to the bank's SIEM (P1, M).
26. INFRA-11 — Roll out and upgrade the Windows app across a bank fleet (P1, L).
27. QA-10 — Time every route as admin, agent and requester, with budgets (P1, M).
28. QA-11 — AI on the air-gapped Server Edition, end to end (P1, M).
29. FEAT-20 — Holiday calendars beyond 1406, with a warning before they run out (P1, S).

## Queue (Q)

### Q-1 · Safe leases: reclaim dead workers' jobs under backlog, stop poison jobs, fence late outcomes, bound handlers
P0 · M · server, web, windows · status: open

**Problem.** Crash recovery has four holes.
1. A dead worker's job is reclaimed only when no job at all is due. Under a backlog it stays `running` for its 5-minute lease plus the whole drain time.
2. max_attempts is checked only when a handler throws. A job that kills its process (out of memory, native crash) is reclaimed and re-run forever. Each time it takes down the leader, which also serves HTTP, and strands the rest of its round for 5 minutes.
3. The lease is fixed and never renewed, and `finish`, `save` and `saveIn` update by id alone. A run that outlives its lease can therefore overwrite the re-claimed run's outcome or progress. This is reachable on the server, because «اجرا اکنون» ticks on whichever worker served it.
4. Nothing bounds a handler. The round waits for all its jobs and the scheduler awaits the tick without a timeout, so one handler that never settles stops all background work while «سلامت سرور» still reports the scheduler as ok.

**Evidence.**
- `src/server/jobs/index.ts`:
  - `:172-184`: due jobs claimed first; `running and locked_until < now()` only when none is due; `interval '5 minutes'`;
  - `:202-239`, `:392-398`: finish, save and saveIn use `where id = $1`;
  - `:400-433`: failed only in the catch path when `attempts >= max_attempts`;
  - `:354-360`: `allSettled` per round.
- `src/server-edition/scheduler.ts:196-197`: awaits the tick with no timeout.
- `src/server/modules/admin/platform.ts:368-370` and `src/server/routes/admin-platform.ts:148`: tickNow runs on the serving worker.
- `src/server-edition/health.ts:101`: the scheduler check is "a leader exists".
- `tests/engine-jobs.test.ts:141-152`: takeover is tested only with an otherwise empty queue.

**Proposal.**
- Claim expired leases in every round: reserve one slot for them, or use a union claim ordered by due time.
- A reclaimed job whose attempts already reached max_attempts is marked failed, with a clear last_error, instead of run again.
- Put a claim token (locked_by + attempts) on every finish, save and saveIn, and drop writes from a run that lost its claim.
- Renew the lease from a heartbeat while a handler runs, or set the lease per kind.
- Give each kind a maximum run time. Past it, the slot is freed and the run abandoned and logged. A watchdog restarts a tick that lasts far beyond its budget.
- On the server, «اجرا اکنون» wakes the leader instead of running jobs on the serving worker.

**Done when.** Real-PostgreSQL tests show that:
- with 1,000 due jobs, an expired-lease job runs again within one round;
- a handler that exits its process is failed after max_attempts reclaims and never loops;
- a stale run's finish or save after a reclaim changes nothing;
- a handler that never settles does not stop other jobs, and the health check turns to danger;
- run-now on a follower runs nothing locally.

The engine-jobs and server-edition suites stay green.

**Depends on.** —

### Q-2 · Priority lanes and per-organisation fairness in the claim
P1 · M · server, web, windows · status: open

**Problem.** Every job of every kind and organisation waits in one FIFO by run_at.
- Bulk work runs ahead of SLA and approval timers, workflow steps, escalations and notifications. Bulk work means organisation seeds, the demo pack, directory sync, RAG re-indexing, CMDB health passes and discovery items.
- An SLA timer's run_at is its due time, so in a backlog it fires late by the drain time.
- On the multi-tenant web edition, one organisation's burst delays all the others.
- No kind has a concurrency limit.

**Evidence.**
- Code:
  - `src/server/jobs/index.ts:181`: `order by run_at, id`;
  - `src/server/db/migrations/0005_engine.ts:32-54`: no priority or lane column, the due index is on run_at only, and no later migration alters the table;
  - `src/server/modules/sla/sla.ts:284`: `sla.timer` is queued with runAt = the due time.
- Measurements:
  - `tests/server-edition-pg.test.ts:121-136`: a seed backlog of 1,000–1,900 jobs sits ahead of an incident's jobs, so the test allows 240 s;
  - PERFORMANCE_FA §19: 7,361 and 10,130 jobs queued after the medium pack;
  - BANK_SIM_FA:65 finding 6: the demo load held the whole background queue (notifications, SLA, indicators) for half an hour before it was chunked.
- Journal wf_466384e2-dd9: "the load's job sits behind its own backlog (FIFO by run_at)".

**Proposal.**
- A `lane` column on sm_jobs, defaulted per kind family where handlers register and overridable by enqueue:
  - lane 0: timers and people's follow-ups (SLA, approval, process and flows timers; `flows.resume`; `notify.send` and `notify.batch`);
  - lane 1: record events;
  - lane 2: module sweeps and recalculations;
  - lane 3: bulk work (`rag.*`, `kb.reindex`, `cmdb.health_*`, `analytics.*`, `demo.*`, discovery pulls and items, `engine.archive`).
- Claim by (lane, run_at) through a partial index `(lane, run_at) where status = 'queued'`. Aging lets low lanes always progress, and slots are reserved per lane.
- Inside a lane, cap the jobs one organisation takes per round (round-robin over organisations with due work). Heavy kinds get per-kind concurrency limits.
- Show the lanes in the consoles.

**Done when.**
- A real-PostgreSQL test: with 10,000 due lane-3 jobs of organisation A, an `sla.timer` of organisation B due now starts in the next round (≤ 2 s on the server), and B's record events start within 5 s.
- A lane-3 job still runs within a bounded aging time under constant lane-0 load.
- `server-edition-pg.test.ts` waits at most 15 s for the incident's own jobs, down from 240 s.
- bank-sim, with at least 7,000 bulk jobs queued: a workflow step or an assignee's notification completes within 5 s at p95.

**Depends on.** —

### Q-3 · Job capacity that scales with the server: continuous slot pool, configurable concurrency, a dedicated job process
P1 · L · server (web: per-record order across instances) · status: open

**Problem.**
- Only the leader runs jobs, four at a time (a code constant). It does so in the same process, pool and event loop that serve its share of HTTP: up to 25 job queries in flight on its 8-connection pool, and event-loop stalls of up to 540 ms under load.
- A round waits for its slowest job, so one long job leaves the other slots idle.
- Adding workers or cores, as SERVER_FA §3 advises above 4,000 users, adds no job capacity.
- Per-record event order holds only inside one claimed batch of one process. That blocks simply adding claimers, and order already fails across web instances.
- The estimated bank peak is 10–25 user writes per second, each followed by 1–2 background transactions.

**Evidence.**
- Code:
  - `src/server-edition/pgtune.ts:87-88`: `JOB_CONCURRENCY = 4`; no kariz.json key (`config.ts:76` has only `scheduler.interval_s`);
  - `src/server-edition/worker.ts:275-293`: only the leader ticks, with a 20 s budget;
  - `src/server/jobs/index.ts:339-370`: claim → allSettled → claim; per-record grouping inside one batch at `:346-351`.
- BANK_SIM_FA:65 finding 6: "the scheduler does not take another job until the one in progress ends".
- `src/server-edition/foreground.ts:3-7` and PERFORMANCE_FA §19: drain, in-flight queries and event-loop stalls.
- PERFORMANCE_FA §9 and §13-5: the peak write rate. SERVER_FA §3: the sizing advice.

**Proposal.**
1. Replace rounds with a continuous slot pool. A free slot claims its next job at once, and record jobs whose key has a running event are skipped.
2. Add `jobs.concurrency` to kariz.json, defaulted from the core count by pgtune and counted in connectionsFor and max_connections.
3. Run jobs in a job-only worker forked by the supervisor, with its own pool and no HTTP. Alternatively, let several workers claim and keep per-record order across processes, through a group_key with a partial unique index over running jobs or `pg_try_advisory_xact_lock` on the key in the claim. The leader keeps chores and singletons.
4. Add a queue benchmark to loadtest/bank-sim: inflow against drain, and the oldest due job's age, under the 2,000-user mix, with a budget.

**Done when.**
- At the bank-peak mix (scaled to the CI runner and extrapolated to the 16-core profile):
  - drain is at least equal to inflow;
  - the oldest due job's age is under 30 s at p95;
  - page p95 stays within the PERFORMANCE_FA §1 targets.
- A 15 s job leaves no slot idle (test).
- Bulk throughput grows at least 1.8× from one to two job processes on 8 or more cores.
- Per-record order holds with two job processes (real-PostgreSQL test).
- SERVER_FA §3 and §20 document the setting and the measured jobs/s for each size.

**Depends on.** Q-1 (fencing before more claimers), Q-4.

### Q-4 · Adaptive yield to people's requests with a guaranteed job share
P1 · M · server, windows · status: open

**Problem.**
- Before each round the leader waits up to 250 ms while any signed-in browser request is in flight anywhere in the cluster, and each worker stays "busy" for 300 ms after its last one.
- At a bank peak (2,000 users ≈ 250–500 requests/s) the gate is almost always busy. That caps the runner near four jobs per 250 ms, about 16 jobs/s.
- Measured under constant use, drain fell from 18 to 7.9 jobs/s while the page time stayed the same (328 vs 332 ms).
- The doc headline credits the yield with 3,622 → 1,627 ms, but runs without the yield measured 1,744, 1,692 and 1,318 ms.

**Evidence.**
- `src/server/jobs/index.ts:305-312`, `:340-343`: YIELD_MS 250 and `quietFor` before every claim.
- `src/server-edition/foreground.ts:24-25`, `:84`: FOREGROUND_LINGER_MS 300; busy = local, reported or others.
- PERFORMANCE_FA §19 (the table and the in-process bench) and §8 (one request per ~8 s per user).
- Journal wf_466384e2-dd9: the notDone note "under constant use the queue drains about half as fast", and finding P-6 on the headline.

**Proposal.**
- Yield on pressure, not on presence. Wait only when one of these passes its threshold:
  - pool waiters, or DB calls in flight above a share of the pool;
  - event-loop lag at p99;
  - request p95 over its target.
- Guarantee a floor: the runner never spends more than X% of wall time waiting, and one slot always runs. Lanes 0 and 1 (Q-2) are never held.
- Make the thresholds kariz.json settings, and export the time spent yielding.

**Done when.**
- The PERFORMANCE_FA §19 bench with continuous browser traffic drains at least 80% as fast as unthrottled, while the 35-call incident page stays within §19's "after" numbers.
- bank-sim scenario 7: the purge takes 230 s or less, and the admin demo incident page stays within its budget.
- A timer that comes due under constant use runs within 2 s.

**Depends on.** Q-2.

### Q-5 · Wake the runner on every enqueue and at the next due time
P1 · M · windows, server, web · status: open

**Problem.**
- **Windows app:** jobs run on a fixed 10 s interval and no write wakes the runner. A workflow's next step waits for the interval, and that is most of the measured 8.9 s. The case page then waits up to 5 s more for «زنده».
- **Server and web:** only writes under `/o/:org` wake or tick the runner, plus the event ingest, ack and flows routes. These jobs wait for the next interval (5 s) or, on the web, for the next cron:
  - jobs queued by Windows apps' `/sync` pushes;
  - jobs queued by `/v1`, including discovery push batches;
  - jobs queued by `/hooks`.
- **All editions:** runners sleep a fixed interval instead of until the next run_at, so a timer fires up to an interval late.

**Evidence.**
- Windows:
  - `src/desktop/server.ts:141-158`: no waitUntil; `setInterval` 10,000 ms with an 8 s budget;
  - PERFORMANCE_E2E_FA:176 (§1-5: 8,858 ms in run 43676017496, budget 45 s) and :207 (§1-7: waking after a write "brings it to a few seconds");
  - journal wf_7d0d5d88-cad notesForNext; journal wf_80b85438-f3e (8,858 and 8,907 ms).
- Server and web:
  - `src/server/app.ts:105-113`: the after-write tick is on the org router only;
  - `src/server/app.ts:121-124`: `/sync`, `/hooks` and `/v1` are mounted outside it;
  - `src/server/routes/discovery-api.ts:40-43` and `src/server/modules/discovery/push.ts:237-240`: the push batch job is queued with no wake;
  - `src/server/routes/event.ts:381`, `:408`: the routes that wake explicitly.
- All editions: `src/server-edition/config.ts:151` and `scheduler.ts:209`, the fixed 5 s interval.

**Proposal.**
- Make the wake part of the queue itself. enqueue and enqueueMany register an after-commit callback that calls `cfg.waitUntil` or `scheduler.wake`. (Alternatively, compare jobCounter on every router.)
- Give the Windows app a waitUntil that schedules a debounced tick about 50 ms later, still honouring busy() and the WAL scheduler. Optionally, the case page asks once right after «ارسال».
- Every runner sleeps until the earlier of its interval and the earliest queued run_at, read through `sm_jobs_due_idx`.

**Done when.**
- desktop-e2e `workflow_start_ms` has a median of 3 s or less over at least 3 Windows runs (from 8.9 s), its budget is re-based (QA-1), and the API p95 and pg_wal budgets do not regress.
- On the server, a /v1/discovery batch's job starts within 1 s.
- A job with runAt T runs within 1 s of T on the server and the Windows app (fake-clock test).
- On the web, a Windows app push's record events run in the same invocation's after().

**Depends on.** —

### Q-6 · Queue SLOs, metrics and health checks
P1 · M · server (console parts also web) · status: open

**Problem.**
- **Health checks:** «سلامت سرور» judges the queue with two coarse checks.
  - The scheduler is "ok" whenever a leader exists, even if its tick hung.
  - The jobs check is at most a warning, and any failure in 24 h hides the backlog-age check.
- **Metrics:** Prometheus has only due, running, failed-24h and the leader flag. There is no oldest-due age, last-tick age, throughput counter, per-kind or per-organisation depth, or wait and run histogram.
- **karizctl status** does not show the queue.
- **Console cost:** the per-kind summary counts every kept job (done jobs stay 3 days). That is 99 ms at 150,000 kept jobs and grows with a bank's daily volume. An index was rejected because it taxes every status change.

**Evidence.**
- `src/server-edition/health.ts:57-65`, `:101`, `:131`.
- `src/server-edition/metrics.ts:188-194`.
- `src/server-edition/worker.ts:284-287` (last_tick recorded) and `:324-330`.
- `src/ui/modules/admin/platform/ServerHealth.tsx:130`: the last tick is shown with no staleness rule.
- SERVER_FA §15 and §21.
- `src/server/modules/admin/platform.ts:305-322`; PERFORMANCE_E2E_FA §2-8; PERFORMANCE_FA §16 «کارهای باز».

**Proposal.**
- Export these metrics, read from the partial indexes rather than full scans:
  - `itsm_jobs_oldest_due_seconds`, per lane;
  - `itsm_scheduler_last_tick_age_seconds`;
  - `itsm_jobs_ran_total` and `itsm_jobs_failed_total`, by kind family;
  - `itsm_job_wait_seconds` and `itsm_job_run_seconds` histograms;
  - the top N due counts by kind and by organisation.
- Health turns to danger when the oldest due job exceeds N minutes, or when the leader's last tick is older than 3 × interval + budget. Backlog and failures get separate checks.
- karizctl status prints the queue depth, the oldest due job and the last tick.
- The consoles' summary counts queued, running and failed jobs from their partial indexes, and done jobs from a small rollup kept by the hourly cleanup. No index is added to the hot path.
- Alerts go out through INFRA-3a's channel.

**Done when.**
- A blocked tick turns the scheduler check to danger within a minute, and last_tick_age grows in `/api/server/metrics` (test).
- With 1M kept jobs, a scrape takes under 50 ms and the console summary 20 ms or less, and the summary equals exact counts (test).
- bank-sim scrapes the metrics after the demo load and checks the oldest due job's age against a budget.

**Depends on.** INFRA-3a (the alert channel).

### Q-7 · Recurring jobs: declare them and keep every chain alive
P0 · M · server, web, windows · status: open

**Problem.** Recurring work is chains of self-re-arming jobs. A chain is started by org seeds (only when an organisation is created or a module is switched on) or by a module's ensure*() on record events. A chain whose job exhausts max_attempts ends for good.
- **Failures add up over the chain's life.** A chain is one job row queued again and again. A run that returns `{ again }` gives its attempt back, but a failed run does not, and nothing resets the count. So a chain ends at its max_attempts-th failure ever, even when the failures are weeks apart.
- **admin.sweep** (daily, max 3 attempts) is the only place where a data export's files are removed and its status set to expired. The files are attachments of the data_export row, served by the generic attachment routes, which never read expires_at. Once the chain ends, exported data stays downloadable past its expiry: a data-exposure risk.
- **security.sweep** (hourly, max 5 attempts) runs the regulatory clocks (overdue and due-soon deadlines), the expiry of exceptions, waivers and risk acceptances, KRIs and planned control tests. Once the chain ends it stops silently. It comes back only when the security seed runs again (the seed job or the admin's re-seed route) or a security incident is created or updated: a compliance-correctness risk.

Dedupe does not stop a twin from running beside a running job. Scheduled flows skip occurrences missed while the server was down.

**Evidence.**
- `src/server/jobs/index.ts`: `:175` (the claim adds an attempt), `:209-210` and `:215` (`attempts = attempts - $4`, 1 only with keepAttempt), `:416` (`{ again }` keeps the attempt), `:426` (a failure re-queues without giving it back), `:422` (failed once attempts ≥ max_attempts).
- `src/server/modules/admin/index.ts:55-63`: admin.sweep, maxAttempts 3, queued by the org seed only.
- `src/server/modules/admin/exports.ts:151-160`: the only expiry path; expires_at is used only at `:140` (set) and `:153` (the sweep), and `src/server/modules/admin/hooks.ts:75` clears it on create. The only export route is the request (`src/server/routes/admin-tenant.ts:231`); downloads go through the generic attachment routes.
- `src/server/modules/orgs/service.ts:53`, `:75` and `src/server/routes/org.ts:140`: seeders run at creation or module enable only.
- `src/server/modules/incident/jobs.ts:31-38`.
- `src/server/modules/security/jobs.ts:13-16` (what security.sweep does), `:36-40` (ensureSecuritySweep, maxAttempts 5), `:96` and `:261` (re-armed by a sec_incident event), `:268-273` (the handler queues itself again); `src/server/modules/security/index.ts:35`, `:68` and `src/server/routes/security.ts:52` (the seed).
- `src/server/jobs/index.ts:120-123`: dedupe applies to queued jobs only.
- `src/server/modules/flows/scheduler.ts:5-6`: "Missed occurrences … are not replayed".

**Proposal.**
- First, in M0: the attachment download of a data_export row refuses once expires_at has passed (a one-line guard), so an export never outlives its expiry while the sweep is down.
- Add `registerRecurring(kind, { every | dailyAt | cron, perOrg, exclusive, catchUp })`.
- A leader chore runs every minute and keeps exactly one queued-or-running instance per active organisation. It recreates missing or failed chains, with an audit line and a health warning.
- A recurring run never ends its chain on failure: it backs off (capped) and raises an alert after N failures in a row; a success resets the count.
- Exclusive singletons are not claimed while a twin runs.
- The consoles list each organisation's recurring jobs with their last and next run.

**Done when.**
- admin.sweep failed 3 times is queued again within 2 minutes, and an alert is raised.
- A security.sweep that failed 5 times is queued again within 2 minutes, and its overdue reminders still fire (fake clock).
- A chain that fails once between successes, again and again, never ends.
- An expired export cannot be downloaded while the sweep is down (the M0 guard's test).
- While an exclusive singleton runs, its queued twin waits.
- Every module sweep is declared and listed per organisation (tests).

**Depends on.** INFRA-3a (the alert channel). Its health warning is a plain «سلامت سرور» check; Q-6 later folds it into the queue checks, so Q-7 does not wait for Q-6.

### Q-8 · Dead-letter tooling: bulk retry and cancel, error groups, payload view, `karizctl jobs`
P2 · M · server, web · status: open

**Problem.** Failed jobs are the dead letter, but the consoles act on one job at a time: retry resets attempts and cancel marks a queued job failed. Missing:
- bulk actions by kind, organisation, error or time;
- grouping of failures by error;
- a view of a failed job's payload;
- a way to release a job stuck `running`.

Failed jobs are also deleted silently after 30 days. On an air-gapped server karizctl has no jobs command; diagnostics only counts jobs by status and kind.

**Evidence.**
- `src/server/modules/admin/platform.ts:324-366`: listJobs returns at most 500 rows without payload; retryJob and cancelJob work by id.
- `src/server/routes/admin-tenant.ts:249-250`.
- `src/ui/modules/admin/platform/Operations.tsx:38-39`, `:81-82`.
- `src/server/jobs/index.ts:241-256`: failed jobs are deleted after 30 days.
- `src/server-edition/ctl.ts:445`; SERVER_FA §21.

**Proposal.**
- Bulk retry and cancel by filter, with a dry-run count and one audit line.
- Failure groups by kind and error signature, with counts and first and last seen.
- A redacted payload view, under the same secret and demo-scope rules as elsewhere.
- "Release" for expired running jobs, and cooperative cancel of a running one.
- Summarise failed jobs before the 30-day delete.
- `karizctl jobs status | failed [--kind] | retry --kind K [--since] | cancel --kind K`, working against the database while the app is offline.

**Done when.**
- After a simulated SMTP outage, one action (console or karizctl) re-queues the last 24 h of failed notify.send jobs, and the action is audited.
- The outage's failures show as one error group.
- An organisation administrator's bulk actions never reach another organisation's jobs (test).

**Depends on.** —

### Q-9 · A self-sufficient, visible queue for the web edition
P1 · M · web · status: open

**Problem.** The web edition has no running worker.
- Jobs run in a 4 s tick after write requests under `/o/:org`, one job at a time, and a remaining backlog is ignored.
- They also run in `/api/cron/tick`: 20 s inside a 60 s function.
- The per-minute heartbeat is an optional, manual pg_cron + pg_net setup. Without it, Vercel Hobby calls the cron once a day, so SLA warnings, reminders, escalations and scheduled flows can be hours late.
- Nothing shows this, because no tick is recorded on the web and «سلامت سامانه» has no queue check.

**Evidence.**
- `vercel.json` crons: `/api/cron/tick` at `17 4 * * *`.
- SETUP_FA §4-1: pg_cron + pg_net, «پیشنهادی».
- `src/server/app.ts:91-96`: the 20 s cron tick.
- `src/server/app.ts:105-113`: the 4 s after-write tick, its result ignored. With no concurrency it runs one job at a time (`src/server/jobs/index.ts:333`).
- `app/api/[[...route]]/route.ts:5`: maxDuration 60. `src/server/cloud.ts:187-193`.
- `src/server/modules/platform/health.ts:12`: the checks are db, migrations, secret, admins and db_size.
- Journal wf_bdc6089f-220, open: "background jobs still depend on writes and on a cron that runs daily on Hobby".

**Proposal.**
- Record each tick (source, time, ran, more) in sm_meta.
- A «صف کارها» health check and console line warn, with the pg_cron instructions, when:
  - no tick has arrived for 3 minutes while jobs are due; or
  - the backlog exceeds 5 minutes.
- The cron route repeats ticks until `more` is false or about 45 s have passed. An after-write tick that ends with `more` chains another while the invocation has time left.
- Web ticks run 2–3 jobs at once, within DATABASE_POOL_MAX.
- A setup check proves the pg_cron heartbeat reaches the app.
- Every route that enqueues wakes the runner (Q-5).

**Done when.**
- With no user activity, an SLA warning due in 2 minutes fires within 70 s on a preview deployment.
- Removing the pg_cron schedule shows a warning within 3 minutes.
- A 2,000-job backlog drains at the cron rate without any writes.
- QA-3's web job covers these checks.

**Depends on.** Q-5, Q-6, QA-3.

### Q-10 · Leader failover for the two-server layout
P2 · M · server · status: open

**Problem.**
- Leadership is a session advisory lock on one PostgreSQL connection. In the documented "very large" layout (application and database on two servers), if the application host dies hard, the database keeps the dead backend, and with it the lock, until TCP keepalive notices. No tcp_keepalives_* are set and Windows' default idle time is 2 hours, so the restarted app has no leader and no background work.
- The leader re-checks its lock only before a tick, so after a network blip it can finish a 20 s tick while a new leader starts.
- The foreground board lives in one supervisor, so a second app server would yield only to its own browsers.

**Evidence.**
- `src/server-edition/scheduler.ts:29-99`, `:192-197`.
- No keepalive settings in `src/server-edition/pgtune.ts`, `src/server-edition/pg.ts` or `src/server/db/postgres.ts`.
- SERVER_FA §3 sizing table: «۳۲ (یا دو سرور: برنامه و پایگاه داده)».
- `src/server-edition/cluster.ts:87-100`: the ForegroundBoard is per supervisor.

**Proposal.**
- Set tcp_keepalives_idle, interval and count in kariz-tuning.conf (for example 30 s, 10 s and 3), and keepalive on the lock connection.
- Check the lock between rounds and abort the tick when it is lost. With Q-1's fencing, a stale leader's writes are dropped anyway.
- Optionally, a heartbeat leader row as a second signal.
- Share the foreground state through PostgreSQL when more than one app host runs.

**Done when.**
- In a bank-sim variant with the database on a second machine, powering off the app machine and starting it again gives a leader within 60 s.
- A dropped lock connection never leaves two leaders running rounds (fake-lock test).
- SERVER_FA documents the layout's failover times.

**Depends on.** Q-1, INFRA-5.

## Performance (PERF)

### PERF-1 · Bound the RAG retrieval cost behind «رخدادهای مشابه» and every RAG panel at bank volume
P0 · L · web, windows, server · status: open

**Problem.**
- «رخدادهای مشابه» opens with every incident page. It scores every chunk that matches an OR of the record's words with ts_rank_cd before it takes the top results. The knowledge panel and the assistant share the same retrieval code.
- When full text finds fewer than 20 hits, a `LIKE '%term%'` fallback scans the chunks with no index.
- Every incident is indexed, so the cost grows with history: 55–85 ms for about 2,000 chunks locally.
- It was never measured at bank volume, because the bank-scale seed builds no RAG chunks and the load test never calls the record page's side panels.

**Evidence.**
- Code:
  - `src/server/modules/ai/rag/retrieve.ts:184`: ts_rank_cd over every `tsv @@ to_tsquery` match, then order;
  - `retrieve.ts:190-198`: the LIKE fallback on `c.norm`;
  - `src/server/db/migrations/0020_ai_rag.ts:68-70`: only a GIN index on tsv, and no later migration indexes sm_ai_chunks;
  - `src/server/modules/incident/actions.ts:244-258`: what the similar panel runs;
  - `src/shared/tables/incident.ts:306`: every incident is indexed.
- Measurements:
  - PERFORMANCE_E2E_FA §2-8: 55–85 ms for 2,058 chunks; 2,414 chunks in the medium pack; 1.5–1.8 s on CI right after the pack;
  - PERFORMANCE_FA §19: the ranking statement at 1,512–1,776 ms in the CI slow-query log before the yield, and «رخدادهای مشابه» 2,279 → 526 ms.
- Gaps: `scripts/seed-bank.mjs` creates no `sm_ai_chunks`; `scripts/loadtest.mjs` makes no similar, known-errors or knowledge-panel calls.
- Journal wf_466384e2-dd9, notDone: the cost is "O(number of indexed incident chunks)".

**Proposal.**
1. Build RAG chunks through the indexer for the ¼ and full-size seeds, and add the incident page's module panels to loadtest.mjs.
2. Bound the full-text stage. Either rank only a capped candidate set (the newest N GIN matches, or same CI, service or category first), or precompute the top-K neighbours of each incident in a job on create and update and serve the panel from that table.
3. Give the LIKE fallback a trigram index on `sm_ai_chunks.norm`, or drop it for large tables.
4. Agree the ranking change with the owner on a labelled set of bank incidents, keeping the access filter exactly as it is.

**Done when.** On a full-scale seed (at least 3M incidents with chunks), on the 16 vCPU profile, under the 2,000-user mix:
- GET `/incident/:id/similar` p95 is 300 ms or less, and the slowest record-page panel 500 ms or less;
- EXPLAIN shows no step proportional to all matching chunks;
- the top 8 agree with today's ranking on the labelled set, at the level the owner sets;
- the access-parity tests are unchanged and green.

**Depends on.** Owner decision on the ranking (see the open questions); the bank-scale data tooling shared with PERF-2.

### PERF-2 · Prove the published sizing on bank-like Windows hardware and data
P0 · L · server, windows · status: open

**Problem.** The sizing table banks are given (16 vCPU, 64 GB and NVMe for 2,000 concurrent users and 3M incidents, plus a larger tier) is extrapolated.
- The load tests ran on a shared 4-core Linux container with PostgreSQL 16 at ¼ scale, with at most 300 virtual users.
- bank-sim uses a 4 vCPU runner with small data plus the medium pack, 40 virtual users for 3 minutes, and the browser on the same machine as the server.

Never measured:
- Windows Server with PostgreSQL 17 at full scale;
- the record page's panels at that volume;
- job throughput under peak load;
- the sync traffic of linked Windows apps;
- backup, restore and upgrade at real size;
- the effect of a bank's EDR or antivirus;
- branch network latency;
- the 503 rate from the deadlocks that remain;
- the Windows app's LAN mode with several office users on one PGlite connection.

**Evidence.**
- PERFORMANCE_FA §3, §5-3, §8, §11: the extrapolation. SERVER_FA §3: the table presented as the bank sizing.
- BANK_SIM_FA §5: real hardware and volume, the multi-year RTO, AV/EDR and «مرورگر و سرور روی یک ماشین» are unproven.
- PERFORMANCE_E2E_FA §2-1: 4 vCPU, 40 virtual users, 180 s.
- BANK_INSTALL_FA §7: RTO measured with a 3 MB backup.
- DESKTOP_FA «چند رایانه در یک دفتر»: no capacity figure for LAN mode.
- Journal wf_434b5124-765, open: 40P01 deadlocks answer 503 «سیستم مشغول است» and their rate was never measured.

**Proposal.** A repeatable "bank lab" run, built from seed-bank.mjs, loadtest.mjs and the bank-sim pieces, on both published profiles (4 vCPU/16 GB and 16 vCPU/64 GB), on Windows Server 2022 or 2025, with the MSI as shipped and Defender or an EDR running with the documented exclusions. It covers:
- full-scale data with RAG chunks and attachments, plus the sync traffic of 150 linked Windows apps;
- a mixed 2,000-user load: full record pages, portal, approvals, assistant and the monitoring push API;
- an 8-hour soak with branch-latency emulation;
- pg_dump, restore (RTO) and MSI upgrade timings at that size;
- LAN mode with 5–20 office browsers.

Do a first run early in M2 to find gaps, and the published run at its end.

**Done when.**
- There is a report per profile: p50/p95/p99 per endpoint and page, job lag, deadlock and 503 rates, CPU, memory and IO, bloat over the soak, and backup, restore and upgrade minutes.
- Every sizing row in SERVER_FA §3 and PERFORMANCE_FA §8 cites a measured run.
- LAN mode has a stated user limit backed by numbers.
- Any budget miss is root-caused and fixed, never by loosening a budget.

**Depends on.** Owner: lab hardware or large Windows runners. PERF-1; Q-3 for the final job numbers.

### PERF-3 · Cut per-page API fan-out: batch the record page's side panels and the shell's common calls
P1 · L · web, windows, server · status: open

**Problem.**
- The incident record page makes 37–40 API calls on the server edition and 39–60 on the Windows app, one GET per module panel.
- They queue behind the browser's 6 HTTP/1.1 connections, and on Windows also behind PGlite's single connection. HTTP/2 is off because NTLM and Negotiate need HTTP/1.1.
- Every page also makes 8 shell calls: me, meta, org, pulse, ai/status, the inbox and approval counts, and the demo banner.
- On the web, every request is a function call that reads the session, the organisation and the access model again.
- Today only list queries are batched.

**Evidence.**
- PERFORMANCE_E2E_FA:
  - §2-8: 37–40 calls on 6 connections, and the 8 shell calls;
  - §1-7: 39–60 calls on Windows;
  - §1-4: the history, journal, links and attachments panels take about 1.7 s on PGlite;
  - §2-4: demo-admin-incident-record makes 40 calls and takes 1,692 ms;
  - §2-7: no HTTP/2.
- PERFORMANCE_FA §14-6.
- `src/ui/records/data/batch.ts` batches lists only (`POST /batch/query`, `src/server/routes/records.ts:140`).
- `scripts/bank-sim/perf.mjs:32`: api_calls_per_page_max is 60.
- Journal wf_466384e2-dd9 notesForNext: batching the side-panel GETs is "the biggest remaining page-load win", and "one shell bootstrap call instead of 8".

**Proposal.**
1. A batch read endpoint (for example `POST /o/:org/batch/get`, with at most N sub-requests). Each item is authorised exactly as its own route and fails on its own. A client micro-batcher serves record extensions and panels, and panels below the fold load after the main record.
2. One shell bootstrap call (me, org, a meta digest, the pulse token, AI status, counts, the demo banner), revalidated by ETag.
3. Server, optional and after step 1: HTTP/2 for API traffic, with HTTP/1.1 kept only for the SSO handshake.

**Done when.**
- bank-sim: the admin incident record makes 12 API calls or fewer, and the shell 3 or fewer per full page load.
- Content is visible within 1.0 s with the medium pack and within 0.8 s with small data on the Windows runner (medians of 3 runs).
- desktop-e2e: the admin incident page is quiet within 1.0 s (about 1.9 s today).
- Tests show each batched item answers exactly as its own route, including per-item 403 and 404.
- api_calls_per_page_max is lowered to 1.5× the new measured maximum.

**Depends on.** UX-1 (lands with the redesigned record page).

### PERF-4 · Windows app backup without a whole copy of the database in memory
P1 · S · windows · status: open

**Problem.** The backup asks PGlite's dumpDataDir for the whole data folder as one in-memory tar before streaming it through gzip.
- Memory rose 1.4 GB with the small demo pack, and the rise grows with the data.
- The app already peaks at about 1.2–1.7 GB, so office PCs with 8 GB (including a LAN-mode office server) risk swapping or crashing during the automatic backup.
- A linked app backs up every 6 hours.

**Evidence.**
- `src/desktop/backup.ts:24-32`: `db.pg.dumpDataDir("none")`, then gzip.
- PERFORMANCE_FA §15: +1.7 → +1.4 GB, and dumpDataDir reads the whole folder at once.
- PERFORMANCE_E2E_FA §1-7 «حافظهٔ پشتیبان», and §1-5 (the 2 and 3 GB peak budgets).
- SETUP_FA §10-2: every 6 h, 30 copies kept.

**Proposal.**
- After the existing checkpoint, pause writes briefly and stream the data folder from disk into tar.gz file by file: node:fs streams, a deterministic order, PG_VERSION last, the format restore already reads. Then resume writes.
- Copy to a temporary folder first if the pause would be too long.
- Measure on a 1–2 GB folder.

**Done when.**
- The working set rises by 150 MB or less while backing up a 1 GB data folder.
- The output restores through the existing restore path (tests).
- desktop-e2e gains a backup step with a memory budget.

**Depends on.** —

### PERF-5 · Split the UI's ≈ 1.5 MB registry chunk
P2 · M · web, windows, server · status: open

**Problem.** The signed-in app's registry chunk is 1,503,678 bytes (329,335 gzip). Most of it is table definitions that GET /meta/tables also sends, and the chunk-size warning is effectively switched off. Every new browser, cleared cache and release downloads it before the first signed-in page; branch PCs on slow links pay the most.

**Evidence.**
- A local build of the merged tree (15 Nov 02:58 UTC; journal wf_c9703374-224): `public/assets/registry-DD30kFG_.js`, 1,503,678 bytes, 329,335 gzip.
- `vite.config.ts:75`: chunkSizeWarningLimit 4000.
- PERFORMANCE_E2E_FA §1-7, §2-8; PERFORMANCE_FA §14-4.

**Proposal.**
- Keep only what routing and menus need in the eager registry, and load each module's table definitions and screens with its route. Alternatively, build the UI's table metadata from the ETag-cached /meta/tables answer.
- Lower chunkSizeWarningLimit to about 600 kB, and add a bundle-size guard test.

**Done when.**
- No eagerly loaded chunk is larger than 300 kB gzip.
- The JavaScript before the first signed-in page shrinks by at least 250 kB gzip.
- bank-sim sign-in to first page and the desktop-e2e first visit are no slower.
- A test fails when a chunk exceeds the limit.

**Depends on.** UX-1 (the kit touches the same bundles).

### PERF-6 · Windows app database upkeep: VACUUM/ANALYZE and a long-run soak
P2 · M · windows · status: open

**Problem.** PGlite runs PostgreSQL as a single backend, so autovacuum and automatic ANALYZE never run, and the app never runs them itself. High-churn tables collect dead rows and stale statistics over months of use, especially on an office PC in LAN mode:
- sm_jobs: every job is claimed, finished and later deleted;
- sm_outbox;
- the sync bookkeeping.

No one has measured an app with months of data.

**Evidence.**
- PERFORMANCE_FA §17 «آنچه سنجیده شد و تغییر نکرد».
- PERFORMANCE_E2E_FA §1-7: «با سال‌ها داده باید دوباره سنجیده شود».
- No VACUUM or ANALYZE under src/server or src/desktop (grep).
- `src/server/jobs/index.ts:172-261`: every job is 2–3 updates plus a later delete.

**Proposal.**
- An idle-time maintenance pass, scheduled like the WAL checkpoints:
  - VACUUM (ANALYZE) the high-churn tables once their dead-row ratio passes a threshold;
  - ANALYZE after bulk loads (the demo pack, the first sync);
  - never inside a transaction, and never while a window request is in flight.
- A soak script that simulates 12 months of a busy agent or office and records table sizes and page timings.

**Done when.**
- Over the simulated 12 months, sm_jobs and sm_outbox stay within 2× their live rows, and the 45 page calls stay within 20% of month 1.
- Maintenance never overlaps a window request (tests).

**Depends on.** —

### PERF-7 · Windows sync: apply pulled pages without blocking the window; time a bank-scope first sync
P2 · M · windows · status: open

**Problem.** Each pulled page (up to 1,000 revisions) is written in one transaction on PGlite's only connection, so the window's requests wait behind it. During the medium bank's first sync (17,666 rows in 19 s), the app's own API answered with p50 489–511 ms and a maximum of 748–759 ms. Agents with a bank-wide scope may pull hundreds of thousands of rows, and that first sync was never timed.

**Evidence.**
- `src/desktop/sync-client.ts:425-470`: one `db.tx` per page, at `:446`.
- PERFORMANCE_E2E_FA §2-4: api_during_first_sync in runs 43166238863 and 43552521943; §1-7.
- PERFORMANCE_FA §17; journal wf_466384e2-dd9 notDone.

**Proposal.**
- Apply each page in sub-transactions of about 100 aggregates, and advance the cursor only after the page's last one; re-applying a page is idempotent.
- Give way to window requests between sub-transactions through busy().
- Time a first sync of a bank-scope agent on the PERF-2 data.

**Done when.**
- api_during_first_sync p95 is 250 ms or less in bank-sim scenario 12.
- Sync tests, including a crash mid-page, show no lost or duplicated rows.
- A first-sync time is documented for a 100k-row scope.

**Depends on.** PERF-2 (data, for the timing only).

### PERF-8 · Faster demo pack load and a quieter aftermath
P2 · M · web, windows, server · status: open

**Problem.**
- The medium pack takes about 16–27 minutes on the 4-vCPU server runner (944 s in the first simulation, 1,086–1,646 s later), and its purge 210–317 s.
- The small pack takes 236–348 s on the Windows app.
- The web edition's load was never measured.
- Much of the time goes to the follow-up jobs (notifications, SLA, indexing), which keep the Windows app at about 20% of a core for minutes.

For sales demos, minutes matter.

**Evidence.**
- BANK_SIM_FA scenario 7: load 944 s, purge 214 s.
- PERFORMANCE_FA §19: 1,086–1,280 s on EPYC 9V74 and 1,554–1,646 s on EPYC 7763; the purge 209.7 → 316.7 s.
- `scripts/desktop-e2e.mjs:75-76`: the small pack takes 292 s against a 600 s budget.
- PERFORMANCE_E2E_FA §1-4 and §1-7.
- PLAN.md line 279 (R-b: «load +65%»).

**Proposal.**
- Profile the load and the purge per step and per job kind.
- Where the zero-trace rules allow, queue table-level bulk jobs (one RAG backfill per table, bulk SLA and score passes) instead of per-record events.
- Run independent loader steps in parallel on the server.
- Put demo jobs in the bulk lane (Q-2).
- Measure the web load, and set budgets per edition.

**Done when.**
- The medium pack loads in 10 minutes or less on the 4-vCPU runner, and the small pack in 150 s or less on the Windows runner (medians of 3), with the purge no slower.
- The demo-purge zero-trace tests stay green.
- A web load time is recorded.

**Depends on.** Q-2 (optional).

### PERF-9 · Windows app first-start I/O: template unpack, first opens, splash hold
P2 · M · windows · status: open

**Problem.**
- The first start unpacks a template database of 7,077 files:
  - 5.5–10.6 s in %APPDATA% on the CI runner's C: drive, against 1.6–2.2 s on drive D:;
  - 6.8 s on run 117's slow machine, against 5.1–5.7 s elsewhere.
- 1.1.1 adds a second pass behind the splash that opens every file again.
- Whether antivirus or the disk causes it has not been checked on a real PC.
- The splash's «آماده است» also holds the window about 0.7 s by design.

**Evidence.**
- PERFORMANCE_E2E_FA §1-7 (first two bullets) and the §1-4 table.
- PERFORMANCE_FA §17: unpackTemplate writes eight files at a time.
- PR #53: `settleFiles` in `src/desktop/db-template.ts`, and the template timings.

**Proposal.**
- Measure on real office PCs running Defender and a typical EDR, and use Process Monitor to attribute the time.
- If antivirus is the cause, document an exclusion and pack the template into fewer, larger files, so there are fewer first opens.
- Keep or drop settleFiles by measurement.
- Decide the 0.7 s hold with design.

**Done when.**
- Real-PC numbers are recorded.
- Cold start takes 5 s or less on a mid-range office PC, or a documented reason says why not.
- The first page after setup stays within the admin budget in each of at least 5 Windows runs.

**Depends on.** PR #53 (1.1.1).

### PERF-10 · Windows app: take PGlite's work off the local server's only thread
P1 · L · windows · status: open

**Problem.**
- The Windows app's local server is one utility process. Its single thread serves the API, the window's code files, the job tick and PGlite.
- PGlite's file I/O is synchronous, and it has one connection. A slow first open (an antivirus scanning a freshly written file, a slow disk) or a long statement therefore holds every request and every code file at once, and parallel calls run one after another.
- Run 117's failure looked exactly like that.

**Evidence.**
- Code:
  - `desktop/src/main.ts:96`: `utilityProcess.fork` of the local server;
  - `src/desktop/server.ts:129-130` (static files from the same process) and `:155-157` (the job tick);
  - `src/server/db/pglite.ts:65` (PGlite in that process) and `:39-40`, `:86-88` (the event loop gets a turn only every 50 ms of database work).
- PR #53's description and PLAN.md (10:50 UTC entry):
  - in run 117, the first home page's 9 shell calls and 35 code files all finished within 150 ms of each other, at 2.7–2.9 s, with the server at about 0% CPU;
  - a Linux replay shows 180 database files opened for the first time;
  - the mechanism is PGlite's synchronous opens on the server's only thread.
- PERFORMANCE_E2E_FA §1-4: 39–41 parallel calls run one after another on PGlite.

**Proposal.**
- Run PGlite in a worker thread, or its own utility process, behind a message-port database interface. The HTTP server, the code files and the stall watch then stay responsive while the database works.
- Serve the window's code files without touching the database thread.
- Keep the 50 ms turn rule inside the worker.
- Measure page and API p95 on the Windows runner before and after.

**Done when.**
- With an injected 2 s hold on a database file open, a code file and a cheap API call still answer within 100 ms.
- desktop-e2e page and API budgets are unchanged or better over at least 5 Windows runs.
- In those runs the stall watch logs no hold of 1 s or more outside the splash.

**Depends on.** QA-1 (the stall-watch evidence from 1.1.1).

## Infrastructure and operations (INFRA)

### INFRA-1 · Release only after every gate passes, and never rewrite an official release
P0 · S · windows, server · status: open

**Problem.**
- **Publishing runs before the gates.** The installers are published from inside the `windows` job, before desktop-e2e and bank-sim run, and server-publish adds the MSI before bank-sim ends. So a red installed-app gate never stops a release.
- **Every main push re-creates the release.** The publish step deletes and re-creates the tag on every main run. Any later push to main under `itsm/**` with an unchanged version replaces the official binaries with rebuilt ones, whose SHA-256 values differ from what banks recorded.
- **Smaller gaps:**
  - cancel-in-progress can cut a main run between the EXE and the MSI publish;
  - clickthrough gates no release job;
  - releases carry no checksum file;
  - the title and the notes describe only the Windows app, though the release also carries the MSI;
  - nothing reads the published assets back: 1.1.0 was checked by hand (download, hash, delete), and two jobs uploaded its two files four minutes apart.

PR #53 works around the rewrite by bumping the version; the pipeline itself is unchanged.

**Evidence.**
- Run 43696253020:
  - «Publish on the Releases page» ran 09:16:16–09:16:27, and the release was published at 09:16:26Z;
  - the MSI was uploaded at 09:20:40;
  - desktop-e2e failed at 09:26:42 (attempt 1);
  - bank-sim ended at 10:07:39.
- `.github/workflows/itsm.yml`:
  - `:14-23`: push on every branch for `itsm/**`, with `cancel-in-progress: true`;
  - `:181-197`: `gh release delete "$TAG" --cleanup-tag -y`, then `gh release create`;
  - `:131`, `:209`, `:267`, `:341`, `:383`: the job dependencies (needs);
  - server-publish uploads with `--clobber` when the tag targets its own SHA.
- Release API for itsm-v1.1.0 (read 15 Nov): name «کاریز (Kariz) 1.1.0 — نسخهٔ ویندوز», a body that describes only Kariz-Setup, `immutable: false`; the EXE uploaded 09:16:21–25Z and the MSI 09:20:38–40Z; digests sha256:0c8f9ef3… and sha256:73374f08….
- PLAN.md 10:50 UTC entry: the release was verified by downloading both files, which were then deleted. `.github/workflows/itsm.yml:370` only lists the asset names; no step compares digests or sizes.
- Journal wf_466384e2-dd9 finding P-4. PR #53's description ("Without the bump, merging this would replace the verified 1.1.0 files with new builds"). BANK_INSTALL_FA §2: banks compare the SHA-256.

**Proposal.**
- Keep building in the existing jobs. Publish from one `release` job that needs check, test, clickthrough, windows, desktop-e2e, server and bank-sim (later also web-e2e, QA-3), runs only on success, and uploads both artifacts from the same run.
- On main, when `itsm-vX.Y.Z` already exists as a non-prerelease, skip publishing with a notice. Never delete an official tag; publishing a new official release takes a version bump.
- Turn on GitHub immutable releases, and give main a concurrency group without cancel-in-progress.
- Attach SHA256SUMS.txt, later also the SBOMs (SEC-5b) and the signatures (SEC-3). The title names both editions, and the notes name both installers with their verified hashes and link RELEASE_FA, SERVER_FA and BANK_INSTALL_FA. Branch previews stay prereleases.
- After the upload, the release job reads the release back by tag:
  1. it compares each asset's digest and size with the build artifacts and SHA256SUMS.txt;
  2. it checks that the MSI's ProductVersion and the EXE's file version equal APP_VERSION;
  3. it runs the install smoke test from the downloaded files.
- Move upload-artifact and download-artifact to their Node 24 majors; the log warns that v4 targets the deprecated Node 20.
- Add a guard test in `tests/packaging-*.test.ts` that parses itsm.yml and asserts the release job's needs and the no-overwrite rule.

**Done when.**
- A deliberately failed desktop-e2e or bank-sim on a test branch creates or changes no release.
- A docs-only push to main with an unchanged version leaves the official release's asset digests unchanged.
- Every release has a matching SHA256SUMS.txt, and its title and notes describe both editions.
- A tampered or truncated asset fails the job, and every official release shows a verify step that lists both digests.
- The guard test fails when a gate is removed from the release job's needs.

**Depends on.** — (before the next merge under `itsm/**` that does not bump the version).

### INFRA-2 · Point-in-time recovery: continuous WAL archiving, minute-level RPO, real restore drills
P0 · L · server · status: open

**Problem.**
- The only server backup is a nightly `pg_dump -Fc` plus a mirror of the attachments, so up to 24 hours of work can be lost. Dumping a multi-gigabyte database several times a day is impractical.
- There is no WAL archiving and no point-in-time restore.
- "Verification" is `pg_restore --list`, which reads the archive but restores nothing.
- RTO was measured only with a 3 MB backup.

**Evidence.**
- SERVER_FA §13: pg_dump at 01:30; verification by `pg_restore --list`.
- BANK_INSTALL_FA §7: RPO up to 24 h; RTO 9 s for the command and 16 s to ready with 3 MB, «چند برابر» with real data.
- BANK_SIM_FA scenario 11: 26 minutes of work lost, by design of the test.
- No archive_mode, archive_command or pg_basebackup in src/server-edition, packaging/server or SERVER_FA (grep).

**Proposal.**
- archive_mode with a verifying archive_command to backup.dir (a UNC path is allowed), set by pgtune and install.ps1.
- A weekly pg_basebackup beside the nightly dump.
- `karizctl restore --to "<time>"`: the base backup plus WAL replay into a new data folder, then the existing swap and restamp logic.
- Attachments mirrored continuously, to match the RPO.
- A monthly automatic test restore into a scratch database, with row-count checks.
- Archive lag and the last successful archive in «سلامت سرور» and the metrics.

**Done when.**
- bank-sim scenario 11 becomes a PITR drill that restores work up to 5 minutes before the failure.
- Archive lag stays within 60 s under the load test.
- The automatic test restore reports in «سلامت سرور».
- The docs state an RPO of 5 minutes or less, and a measured RTO for the medium pack and for the PERF-2 data.

**Depends on.** —

### INFRA-3 · Monitoring and alerting: export what «سلامت سرور» knows, push alerts, guard runaway statements
P0 (INFRA-3a) · P1 (INFRA-3b) · M · server · status: a open; b open

**Problem.**
- **Health is computed but not exported.** «سلامت سرور» computes backup age and failures, disk space, queue age, event-loop lag and the certificate state. Prometheus, however, exports only process, HTTP and pool counters plus three queue gauges.
- **Nothing pushes an alert.** No Windows Event Log entry and no e-mail goes out when a backup fails, a disk fills, the queue stalls or the certificate nears expiry. Banks monitor with SCOM or Zabbix.
- **Retries are not counted.** Deadlock and serialisation retries, and the 503 «سیستم مشغول است» answers they end in, are not counted.
- **No statement timeout.** No connection pool sets statement_timeout, so one runaway query can hold a connection indefinitely.

Until INFRA-2 ships, the nightly dump is the bank's only recovery point, and a backup that fails silently for weeks, or a full backup disk, is a data-loss risk. So part a, the alert channel with backup-failure and disk alerts, is P0.

**Evidence.**
- `src/server-edition/metrics.ts:176-193`: no backup, disk or certificate metric.
- `src/server-edition/health.ts:57-65`, `:103-131`; `:82-119` computes the disk and backup states for the page only.
- Only the installer has an event source (`src/server-edition/names.ts:25-26`). Event Log entries are written only by the installer scripts (`packaging/server/scripts/install.ps1:176`, `:378`; `common.ps1:40-53`); nothing under src writes one (grep).
- `src/server/db/postgres.ts:129` has a statementTimeoutMs option that `src/server-edition/worker.ts:186` and `src/server/cloud.ts:56` never pass.
- SERVER_FA §18: 503 from 40P01 and 40001.
- Journal wf_434b5124-765, open: rare deadlocks remain, and HTTP imports answer 503 without a retry.

**Proposal.**
- **INFRA-3a (P0, S, M1; or inside INFRA-2):**
  - one alert channel, used also by Q-6 and Q-7: the running service writes Event Log entries (source Kariz) when a check changes state, with hysteresis and a clear when it recovers;
  - its first checks: a failed backup, and a folder (data, blobs, backups, logs) past its free-space threshold;
  - the metrics `itsm_backup_last_success_age_seconds`, `itsm_backup_last_failed` and `itsm_disk_free_bytes{folder}`.
- **INFRA-3b (P1, M, M1):**
  - export days to certificate expiry, the oldest due job (per lane after Q-2; see Q-6), database retries by SQLSTATE, and 503-busy answers;
  - optional e-mail and an in-app notice to platform administrators on the same channel;
  - a configurable per-request statement_timeout (for example 30 s, with SET LOCAL in request transactions); jobs keep their own budgets;
  - documented alert thresholds.

**Done when.**
- INFRA-3a:
  - in bank-sim, a forced backup failure writes one Event Log error and later one clear;
  - the metrics show the backup age, and a full backup folder raises the error;
  - the new metrics have unit tests.
- INFRA-3b:
  - bank-sim asserts that the remaining metrics are exposed;
  - a deliberately slow request statement is cancelled at the timeout with a clear Persian error;
  - SERVER_FA §15 lists every metric with a suggested alert.

**Depends on.** —

### INFRA-4 · Measure and bound upgrade downtime at bank scale
P1 · M · server · status: open

**Problem.** An MSI upgrade stops KarizApp first, then takes a full pg_dump safety backup plus the attachments while the service is down, then migrates. The engine adds indexes without CONCURRENTLY, which blocks writes to large tables. The only measurement is 52 s on tiny data, so a bank cannot plan a maintenance window for 30 GB or more.

**Evidence.**
- `packaging/server/scripts/uninstall.ps1:71-77`: Stop-Svc, then `karizctl backup --label pre-upgrade`.
- SERVER_FA §14 describes the same sequence.
- PERFORMANCE_FA §9: «افزودن نمایه به جدول بزرگ در ارتقا … ۲۴۰ ثانیه … بیرون از ساعت کاری».
- No CREATE INDEX CONCURRENTLY under src/server/db.
- BANK_SIM_FA scenario 5: 52 s.

**Proposal.**
- Take the safety backup online, before stopping the service (pg_dump is snapshot-consistent). With INFRA-2, record a restore point instead.
- Stop the service only for the file swap and the migrations.
- Build new indexes on large tables CONCURRENTLY, outside the migration transaction and resumable.
- Add `karizctl upgrade-plan`, which estimates downtime from table sizes and pending DDL, and print progress in the install log.
- Measure on the PERF-2 data.

**Done when.**
- On full-scale data, an upgrade between consecutive versions keeps the app down no longer than a documented, measured limit (target 5 minutes).
- No write is blocked by an index build.
- Rollback still returns to the pre-upgrade state.
- The docs state the expected downtime per database size.

**Depends on.** INFRA-2, PERF-2.

### INFRA-5 · Two-server layout: the app against a separate or bank-provided PostgreSQL
P1 · L · server · status: open

**Problem.**
- The largest sizing tier says "32 vCPU, or two servers: application and database".
- But the MSI always creates a local cluster that listens only on 127.0.0.1, and KarizApp depends on KarizDB.
- Running the app against a database on another host, over TLS, or against a bank's existing PostgreSQL with its own HA and DBA practices is neither documented nor tested.
- The configuration already reads db host, port and ssl.

**Evidence.**
- SERVER_FA §3 row «خیلی بزرگ», and §17.
- PERFORMANCE_FA §7, §8.
- `packaging/server/scripts/install.ps1:4-7`: initdb, a tuned postgresql.conf and a loopback-only pg_hba.
- `packaging/server/winsw/app-service.xml.template:16`: `<depend>` on KarizDB.
- `src/server-edition/config.ts:140`, `:252-260`: db host, port, ssl and max_connections, defaulting to 127.0.0.1.

**Proposal.** An MSI mode, `DBMODE=external` with DBHOST, DBPORT, DBNAME and DBUSER (the password from a protected prompt or file), that:
- skips KarizDB;
- checks the remote server: PostgreSQL 16 or later, pg_trgm, pg_stat_statements and vector, max_connections, ICU;
- requires TLS with verify-full against the bank CA;
- migrates with a least-privileged owner role;
- prints pgtune's recommended postgresql.conf for the database host.

Also document a Linux database host, and add a bank-sim variant with the database on a second machine over TLS.

**Done when.**
- A CI variant installs in external mode against PostgreSQL 17 over TLS and passes bank-sim scenarios 3–12.
- karizctl backup and restore work against the remote database.
- The docs give the pg_hba, TLS and role steps for Windows and Linux database hosts.

**Depends on.** —

### INFRA-6 · High availability: standby database, failover, a second app node
P1 · XL · server · status: open

**Problem.** There is no high availability.
- One server runs both services, and recovery means restarting them on the same machine.
- Losing that server means a manual reinstall and a restore from the last nightly backup.
- Streaming replication, a standby, failover and a second app node are neither supported nor tested.
- Per-process state (rate-limit buckets, the per-node foreground board) would not be shared.

**Evidence.**
- SERVER_FA §2 «بازیابی خودکار».
- BANK_SIM_FA scenario 9: processes are killed and restarted on one machine.
- BANK_INSTALL_FA §7 «خرابی کامل سرور».
- No replica, standby, failover or wal_level in src/server-edition, packaging/server or the server docs (grep).
- `src/server/http/hono.ts:211-221`; `src/server-edition/foreground.ts`.

**Proposal.**
- Phase 1, with INFRA-2:
  - `karizctl standby init <primary>` builds a hot standby with streaming replication and a replication slot;
  - health and metrics show replication lag;
  - `karizctl promote`, with a drilled runbook for the DNS or VIP switch. The existing restamp and epoch rules cover the Windows apps.
- Phase 2, with INFRA-5:
  - two app nodes behind the bank's load balancer (`/api/ready`), with a shared UNC blob store;
  - cluster-wide rate limits and foreground signal through PostgreSQL.
- Publish the RTO and RPO for each mode.

**Done when.**
- A drill kills the primary under load and promotes the standby. The app is back within an RTO of 15 minutes or less, with an RPO of 1 minute or less.
- Linked Windows apps resync as documented.
- The runbook is in SERVER_FA and BANK_INSTALL_FA.

**Depends on.** INFRA-2, INFRA-5; the owner's scope (see the open questions).

### INFRA-7 · Web edition operations: automated backups and a production plan profile
P1 · M · web · status: open

**Problem.**
- Supabase Free has no backups. The docs suggest a linked Windows app, whose copy holds only what that account may read, or a manual weekly pg_dump.
- Vercel Hobby keeps logs for 1 hour and is for non-commercial use only.
- There is no documented production profile.
- The obvious one, Vercel Pro + Supabase Pro, may be out of reach: SETUP_FA says paying for those plans needs a non-Iranian card, and the whole guide uses the free plans. Without another route, the web edition keeps no automatic backup, 1-hour logs, a cron tick once a day and Hobby's non-commercial terms.

**Evidence.**
- SETUP_FA on main:
  - `:38`: «پرداخت پلن‌های پولی Supabase و Vercel کارت غیرایرانی می‌خواهد. همهٔ این راهنما با پلن‌های رایگان انجام می‌شود.»;
  - §10-2 (`:536`, no automatic backup on Free; `:546`, Pro at 25 USD a month with daily backups);
  - §10-4 (Hobby «فقط غیرتجاری») and §9 (logs kept 1 h).
- `vercel.json` on main: /api/cron/tick at `17 4 * * *`.

**Proposal.**
- An automated off-site backup with a restore tested in CI against a scratch database: a scheduled GitHub Actions pg_dump to encrypted storage, or documented Supabase Pro PITR.
- Two documented production profiles beside the free demo profile:
  - Vercel Pro + Supabase Pro, with a per-minute cron, longer logs and backups, for an owner who can pay abroad;
  - one that needs no foreign payment: the same Next.js build, or the server edition's Node bundle (INFRA-10), on an Iranian VPS or the customer's container host; a self-managed PostgreSQL; a system cron calling /api/cron/tick every minute; and the tested backup above.

**Done when.**
- A weekly backup restores in a CI test.
- SETUP_FA documents both profiles and their limits, including one that someone with Iranian payment means only can set up, with a per-minute tick and a backup that restores in CI.

**Depends on.** QA-3 (the test projects); the owner's answer to open question 6 (the web edition's target and which payment route exists).

### INFRA-8 · Client crash reporting for an air-gapped product
P2 · S · web, windows, server · status: open

**Problem.** UI crashes go only to the browser console. Support in a bank, where external telemetry is not allowed, has no record of what users hit. The click-through round asked for a client crash-reporting API; it was never built.

**Evidence.**
- `src/ui/components/crash.tsx:28-31`: componentDidCatch only calls console.error.
- No client-error route exists in src/server/routes.
- PLAN.md (19:20Z Nov 10): "client crash reporting API" among the engine requests.
- SERVER_FA:285: the diagnostics bundle has no client errors.

**Proposal.**
- `POST /api/client-errors`, accepted signed in or out, rate-limited, size-capped and stripped of field values. It stores the message, stack, route, version and persona.
- window.onerror and unhandledrejection report too.
- The errors are listed in the platform console and «سلامت سرور», and the last ones go into `karizctl diagnostics`.

**Done when.**
- A forced crash appears in the console list within seconds.
- A test covers the rate limit.
- The diagnostics bundle holds the last N client errors, with no field values.

**Depends on.** —

### INFRA-9 · Bundled runtimes' lifecycle (Node 22, PostgreSQL majors)
P3 · M · server, windows · status: open

**Problem.** The MSI bundles Node 22.23.4 and PostgreSQL 17.11. Node 22's maintenance support ends in April 2027, by the public Node.js release schedule. There is no path to move an installed bank database to the next PostgreSQL major version.

**Evidence.**
- `packaging/server/deps.json`: node 22.23.4, postgresql 17.11, pgvector v0.8.7.
- No pg_upgrade in packaging/server or src/server-edition.

**Proposal.**
- A runtime policy: move to Node 24 LTS before April 2027, and ship PostgreSQL minor updates with every release.
- `karizctl pg-upgrade`: pg_upgrade --link after a pre-flight backup, with dump and restore for small databases.
- A bank-sim scenario that upgrades from the previous major version.

**Done when.**
- A support matrix is documented.
- A CI scenario upgrades a PostgreSQL 17 data folder to the next major and passes bank-sim scenarios 6–12.

**Depends on.** —

### INFRA-10 · Linux host for the server edition
P3 · L · server · status: open

**Problem.** The server edition installs only on Windows (a WiX MSI, WinSW services and PowerShell scripts). Banks that standardise on Linux have no option for app nodes, although the app already runs on Linux in development and pgtune has Linux values.

**Evidence.**
- packaging/server contains only wix/, winsw/ and scripts/*.ps1.
- SERVER_FA §4: Windows Server 2019, 2022 or 2025 only.
- PERFORMANCE_FA §2, §7.

**Proposal.** After INFRA-5, an offline Linux package for app nodes (RPM/DEB, or an OCI image with systemd units), plus a documented PostgreSQL on RHEL or Ubuntu, reusing pgtune and karizctl.

**Done when.** A Linux bank-sim variant passes install, setup, load, backup and restore, and upgrade.

**Depends on.** INFRA-5; the owner's interest.

### INFRA-11 · Roll out and upgrade the Windows app across a bank fleet: per-machine silent install, update from the server, protocol overlap, data out of the roaming profile
P1 · L · windows, server · status: open

**Problem.** A bank links hundreds of agent PCs to the server edition, but the app cannot be rolled out or upgraded the way bank fleets are managed.
- **Per-user only.** The installer always installs for the current user. A deployment tool that runs as SYSTEM (SCCM, Intune) would install it into the SYSTEM profile. A silent per-user install (`/S`) works and CI uses it, but no guide tells administrators how.
- **No updater.** The app has no update mechanism.
- **Lockstep upgrades.** The server refuses an app of any other sync protocol, on push and pull alike. RELEASE_FA asks banks to upgrade every app at the same time as the server, and FEAT-15 bumps the protocol again. In a bank, each such upgrade leaves every PC without sync until someone reinstalls it by hand.
- **Roaming data.** The app keeps its PGlite database (the template alone is 7,077 files) and up to 30 backups under %APPDATA% (Roaming). Roaming profiles and folder redirection, common in bank domains, copy that folder at logon or move it onto a file share.

**Evidence.**
- `desktop/build/installer.nsh:4-7`: customInstallMode forces the current-user install. `desktop/electron-builder.yml`: NSIS target only, oneClick false, perMachine false.
- `.github/workflows/itsm.yml:163` and `:231`: CI installs Kariz-Setup with `/S`, «as a software deployment would». The guides document a silent install only for the MSI (SERVER_FA §5 «بی‌صدا»), and SERVER_FA §16 links the app PC by PC.
- No electron-updater or autoUpdater in desktop/package.json, package.json, desktop/src or src (grep).
- `src/server/routes/sync.ts:155-186`: an app of another protocol is told to update, on push and pull alike; `src/shared/constants.ts:30`, `:37-39`.
- `docs/RELEASE_FA.md:75`: upgrade the Windows apps «هم‌زمان با سرور».
- `desktop/src/main.ts:25-28`: the data under app.getPath("appData")\ITSM. `src/desktop/backup.ts:10-11` and `src/desktop/config.ts:31`: backups in the data folder, 30 kept, one every 6 h.

**Proposal.**
1. A per-machine install for fleet tools: allow `/allusers` instead of forcing the current-user mode, or ship an MSI wrapper, and document the silent commands for SCCM, Intune or GPO in BANK_INSTALL_FA.
2. The server edition hosts the Kariz-Setup of its own version. An outdated app offers «به‌روزرسانی از سرور», checks the signature (SEC-3) and installs it.
3. The server accepts the previous sync protocol for one release, so upgrades can roll through the fleet.
4. Move the data and backups to %LOCALAPPDATA% with a one-time migration, or document the ExcludeProfileDirs policy.

**Done when.**
- CI installs the app silently, per machine.
- In bank-sim, an app one protocol behind keeps syncing, updates itself from the server, and then syncs on the new protocol.
- The data folder is outside the roaming profile.
- BANK_INSTALL_FA has the fleet steps.

**Depends on.** SEC-3 (the signature check), INFRA-1.

### INFRA-12 · Web edition: attachments in object storage, past the 4.5 MB request cap
P2 · M · web · status: open

**Problem.** On the web edition:
- an attachment travels in one function request, which Vercel caps at about 4.5 MB, although the organisation's attachment setting defaults to 10 MB;
- its bytes are stored inside PostgreSQL (sm_blobs), which Supabase Free caps at 500 MB for everything.

So a set of screenshots or a log bundle cannot be attached, and attachments push the database toward 402 answers and read-only mode.

**Evidence.**
- `src/server/blobs.ts:1-5`: the web version keeps attachment contents in sm_blobs.
- `src/server/engine/attachments.ts:4-5`: the web platform caps request bodies at about 4.5 MB; `:31`: the default is 10 MB; `:32`: the hard maximum is 100 MB.
- `docs/SETUP_FA.md` on main: `:456` (past the free 500 MB, answers become 402 or the database turns read-only) and `:464` (413 FUNCTION_PAYLOAD_TOO_LARGE above 4.5 MB).

**Proposal.**
- A BlobStore on Supabase Storage or any S3-compatible store:
  - signed direct uploads and range downloads, so the bytes never pass through the function;
  - the same sha256 dedupe and access checks;
  - a migration of the existing sm_blobs rows.
- Until then, the web upload UI states the 4.5 MB limit.

**Done when.**
- A 25 MB attachment uploads and downloads on a preview deployment.
- The database size does not grow with attachment bytes.
- QA-3's web-e2e covers it.

**Depends on.** QA-3; the owner's answer to open question 6.

## Design and UX (UX)

### UX-1 · Bring the P0 kit and the Q tooling onto main in one reviewed merge
P1 · L · web, windows, server · status: open

**Problem.** The kit and the QA tooling are 111 commits on rd-base, forked from 88ecfba on 11 Nov. Main has 480 commits since then, including about 26,000 lines in 111 new UI files built on the old kit. A naive merge can silently undo main's performance work and break test gates that exist only on rd-base.

**Evidence.**
- `git rev-list --count`: 88ecfba..rd-base is 111, and 88ecfba..origin/main is 480.
- `git merge-tree --write-tree origin/main rd-base` conflicts in 8 files:
  - `scripts/ui-crawl.mjs`
  - `src/shared/model/types.ts`
  - `src/ui/App.tsx`
  - `components/shell/CommandPalette.tsx`
  - `components/shell/Topbar.tsx`
  - `modules/home/index.tsx`
  - `records/fields/display.tsx`
  - `records/page/RecordPage.tsx`
- Semantic conflicts (journal wf_c9703374-224, design pass):
  - (a) rd-base's App.tsx imports ROUTES and AppShell eagerly, while main moved them into the lazy `src/ui/OrgArea.tsx`. That move took the entry JavaScript before sign-in from 2,871 to 693 KB (PERFORMANCE_FA:403).
  - (b) Two leave guards: rd-base's `src/ui/lib/leave.ts` and main's `modules/workflows/admin/forms/leave.ts` (6a72f43).
  - (c) Two primary-transition flags: rd-base's `Transition.primary`, and the lifecycle overlay's primary on main (`src/shared/model/lifecycle.ts:41`, `:61`, `:169`).
  - (d) rd-base's `tests/ui-lint.test.ts` ratchet would flag 21 new module files.
  - (e) rd-base's owners map (`tests/ui-clickthrough.test.ts:285-289`) has no package for `modules/{workflows,discovery}`.
  - (f) LOADERS in `scripts/desktop-e2e.mjs:109` and `scripts/bank-sim/perf.mjs:63` miss the kit's `.ds-state[aria-busy="true"]` and `.ds-skel`, which would quietly loosen the page budgets.
  - (g) rd-base's full vitest never passed in one run: 12 timeouts and demo-purge (journal wf_ae679a62-9a5).

**Proposal.**
1. Make a branch from main and run `git merge rd-base` once. Do not rebase the 111 commits.
2. Resolve the conflicts this way:
   - keep main's OrgArea split, and port rd-base's StateBlock 404 and crash screens and its page titles into OrgArea.tsx;
   - keep one leave guard: rd-base's pathname rule with «ماندن» as the default, plus main's holdBrowserHistory and confirmLeave callers, including the shell's F5-3 calls in the rewritten Sidebar;
   - keep one `Transition.primary`, read by `records/model/actions.ts` primaryTransition;
   - in ui-crawl.mjs, keep rd-q's shots mode together with main's F/A seeds (43d2bb0, 81ad019, c8dc193, e8da987, bbbdd60).
3. In the same push:
   - add the kit's loading markers to LOADERS in desktop-e2e and bank-sim (stricter, not looser);
   - record the merged tree's lint counts as main's first baseline;
   - regenerate owners.json after UX-2 part A.
4. Push once, within the two-hour rule.

**Done when.**
- typecheck is green, and the full vitest passes in one run with no timeouts and demo-purge passing.
- check:schema is unchanged, and check:tokens and the no-env build are green.
- qa:lint shows no rise, and `qa:owners --check` passes.
- crawl --quick ×3 personas and the full crawl show 0 problems.
- desktop-e2e and bank-sim are green with unchanged budgets.
- The JavaScript before the sign-in form is still about 693 KB, and the kit's CSS growth is reported.
- The incident record still has 5 or fewer header controls and 1 filled button, with the activity above the fold.

**Depends on.** UX-2 part A; the CI engineer for LOADERS.

### UX-2 · Update the redesign plan for 1.1 main and keep its evidence durably
P1 · M · web, windows, server · status: open

**Problem.**
- **The plan describes 1.1-beta.** C2-INVENTORY covers 79731db and 1,397 routes; main registers 1,417.
- **1.1 final added routes no package owns:**
  - settings/fields;
  - settings/forms and its two designers;
  - settings/workflows, with its designer and lifecycle editor;
  - settings/positions;
  - workflows/*, portal/workflows* and settings/workflows-kit;
  - discovery, with /new, /reconcile, /status and /:id.
- **Stage B's v2 plan was never produced.**
- **The day-0 baseline is light-only** outside P0.
- **The golden images and the 60 vision findings** live only in the scratchpad and the journals.

**Evidence.**
- C2-INVENTORY header; CLICKTHROUGH.md («1417 registered routes»).
- `src/ui/modules/workflows/index.tsx`, `src/ui/modules/discovery/index.tsx:59-111`; C2-PACKAGES §1.2 has no globs for these folders.
- PLAN.md: the stage-B planning run wf_09664c3a-73e, «all 8 agents failed … abandoned».
- rd-base `docs/qa/BASELINE.md` («Rendering: light») and `docs/qa/VISUAL.md` («No findings filed yet»).
- 60 VQ ids in journal wf_ae679a62-9a5.
- Scratchpad: `qa-shots/` (1.6 GB) and `qa-data/golden`.

**Proposal.**
- Part A, before UX-1:
  - add a package P8 «فرم‌ها، گردش‌کارها و منبع‌های داده», owning `src/ui/modules/{workflows,discovery}/**`, with ★ screens and template codes taken from design F §8 and design A §15;
  - write it into C2-INVENTORY and C2-PACKAGES;
  - rebuild the RD-B unit list for P1–P8.
- Part B, after UX-1:
  - regenerate owners.json;
  - shoot a new day-0 baseline on the merged main: bank and fresh data, light, dark and phone, all personas;
  - file the 60 findings, with status and image paths, as `docs/qa/visual/<pkg>.jsonl`, and regenerate VISUAL.md;
  - keep the golden images in a durable store (a CI artifact with retention, or an asset store), with a manifest in git.

**Done when.**
- `qa:owners --check` passes with every route in P0–P8.
- VISUAL.md lists the 60 findings with their states.
- BASELINE.md is refreshed, including dark and phone counts.
- The RD-B v2 units cover every route.
- The golden images survive a scratchpad cleanup.

**Depends on.** DOC-1 (the designs in git); part B on UX-1.

### UX-3 · Close package 0's gate on main: re-shoot and approve the golden screens
P1 · M · web, windows, server · status: open

**Problem.** The golden screens, the P0 reference every module is compared with, were never approved.
- Vision rounds 1–3 went 27 → 14 → 8 S1–S3 findings, and every one was fixed.
- Round 4 stopped at a usage limit, and then the owner moved the redesign to 1.2.
- Round 4's partial notes add one S3: the empty palette lists every space's create actions in registry order, not the current space's first.
- 17 S4s are open.
- Kit-level automated defects repeat on every page.
- The C2-SPEC §5 list and record shortcuts are missing.

**Evidence.**
- Journal wf_ae679a62-9a5: verdicts NOT APPROVED from a588d57b0de7d1846, a8216ec955181703a and a6cd01dbabc1f02c8; round-4 agent a0dd8d0099d4548e6 ended with «You've hit your 5-hour limit». PLAN.md: owner decision of 08:40 Nov 14.
- Scratchpad `vq4/notes.md`: rd-base `CommandPalette.tsx:388` (`items.filter(x=>x.action)`; SPEC §2.5).
- Open S4s: VQ-P0-008/054, 031, 043–047, 055–058 and VQ-Q-028/029/030/059/060.
- Scratchpad `qa-shots/golden-4/bank/AUTO.md`: 352 of 365 P0 images flagged.
  - S1: axe:label ×2.
  - S2: untranslated 83, label-content-name-mismatch 78, missing-name 63, aria-prohibited-attr 34, aria-hidden-focus 10, color-contrast 8, focus-visible 3.
  - S3: tiny-text 355, touch-target 133.
- P0b notDone (a2fe7ef2dfd0ae2e5): the shortcuts c, f, Shift x, e, r, n, [ ] and Alt 1…9.

**Proposal.**
1. After UX-1, restart the golden server on the merged build.
2. Re-shoot the C2-PACKAGES §2.5 checklist: bank and fresh data; light, dark, phone and phone-dark; laptop 1280 for records.
3. Run vision round 4, with at most two more rounds.
4. Fix the palette S3 and the kit-level automated hits listed above.
5. Batch-fix the S4 backlog.
6. Add the SPEC §5 shortcuts to `lib/keys.ts` and the `?` sheet.

**Done when.**
- C2-PACKAGES §2.4 items 1–7 hold on main.
- The vision reviewer reports zero S1–S3 on the golden screens.
- axe shows zero critical or serious issues on the P0 ★ screens, in both themes.
- tiny-text, touch-target, missing-name and untranslated are zero on shell elements.
- ui-lint shows zero blocking hits in P0 files.

**Depends on.** UX-1, UX-13.

### UX-4 · Stage B wave 1: P1 operations/change/delivery, P2 service/portal/knowledge, P3 configuration/assets
P1 · XL · web, windows, server · status: open

**Problem.** Module pages still have the 1.0/1.1-beta layout, and main's record header and list kit are unchanged since 1.1-beta:
- the incident header shows transitions and module actions as equal buttons;
- lists have three toolbar rows and default columns that clip;
- the «پیکربندی» sidebar opens at 83 rows;
- the portal uses two accents and has no phone navigation.

The day-0 automated defects concentrate in these packages.

**Evidence.**
- RELEASE_FA:51.
- `git diff 88ecfba origin/main` is empty for `records/page/RecordHeader.tsx` and `records/list/RecordList.tsx`; RecordHeader.tsx:24 has `VISIBLE_TRANSITIONS = 3`.
- C2-INVENTORY §3, §4.1 and §5.
- C2-PACKAGES §3–5, in design units / effort points: P1 205 / 132, P2 155 / 174, P3 235 / 148.
- BASELINE.md, bank images S1 / S2 / S3: P1 67 / 726 / 671, P2 5 / 231 / 354, P3 29 / 586 / 476. The worst routes are releases/:id, changes/:id, assets/:id and incidents/:id.
- P0a notes (journal wf_ae679a62-9a5, ae29a039cfe298231): P1 must mark primary transitions and summary fields; the SLA, knowledge and CMDB panels must adopt isEmpty.
- Main has 68 headerActions registrations in 27 module files; under the kit they fold into «اقدام‌ها» (rd-base `records/extensions.ts:104-107`).

**Proposal.** Run the P1, P2 and P3 RD-B units on the merged kit, at most 4 at once. Each unit meets C2-PACKAGES §1.5:
- its SPEC §3 template;
- ActionSpec header actions, with at most one promoted («اتاق عملیات» only on major incidents);
- at most 7 default list columns, plus summary fields;
- StateView states and chartKit;
- logical CSS and type roles.

Order:
1. incident record, queues and war room;
2. approvals inbox;
3. change calendar and CAB;
4. request queues and catalogue;
5. requester portal (bottom tab bar, one accent, a conversation-first ticket);
6. KB reader and editor;
7. CMDB map and nav folding;
8. bank ITAM (branches, ATM fleet, register, mobile scan).

**Done when.**
- Per package:
  - zero blocking lint hits in its files;
  - a crawl of its routes as its personas in light, dark and phone shows no console errors, no failed requests, no horizontal scroll at 390 px and no axe serious or critical issue;
  - the vision review has no open S1 or S2, and every S3 is fixed or waived.
- Package checks:
  - the war room and CAB work at 1024 px and on a phone;
  - approvals work with a/r and undo;
  - the portal is usable one-thumbed at 360–390 px, with a sticky composer and an AA-contrast accent;
  - KB lines are at most 72 characters;
  - a branch officer sees only their own branch;
  - the mobile scan works at 390 px.
- typecheck, tests and build are green, check:schema is unchanged, and the desktop-e2e and bank-sim budgets are unchanged.

**Depends on.** UX-1, UX-2, UX-3.

### UX-5 · Stage B wave 2: P4 monitoring/security/SLM, P5 enterprise/field/automation, P6 analytics/AI/console, P7 administration/entry/Windows native
P1 · XL · web, windows, server · status: open

**Problem.** The rest of the product keeps the old layout and its recorded defects. Examples:
- SLM KPI values sit 400 px from their labels;
- dispatch-board time labels are clipped;
- the analytics dashboard is 637 lines with 15 unlabeled icon buttons;
- the members page is a 500-line dense table;
- roles pages have 19 hard-coded font sizes;
- help has no search.

**Evidence.**
- C2-PACKAGES §6–9: P4 200 / 128, P5 156 / 126, P6 56 / 148, P7 56 / 128.
- C2-INVENTORY §4.2–4.4 and §6.
- BASELINE.md, bank images S1 / S2 / S3: P4 3 / 196 / 276, P5 1 / 194 / 270, P6 8 / 72 / 69, P7 1 / 183 / 134.
- ui-lint on main: direct-recharts 18, antd-table 144, toast-direct 137.
- `src/ui/modules/settings/Help.tsx`: 691 lines, no search field (SPEC §3.13).
- Fix round 3 skipped the ESM agent desks, which need department workspaces in shellAccess (aa7c2f6547a36e8ed).

**Proposal.** Use the same unit rhythm as wave 1, interleaved within the 4-unit limit.
- P4: the event console as a live workbench; on-call on the calendar template with an RTL time axis.
- P5:
  - a full-bleed dispatch board with a phone agenda;
  - flow-designer chrome per SPEC §3.7;
  - rule and template editors with a live preview and an unsaved-changes guard;
  - ESM desks per department workspace.
- P6:
  - every chart through ChartCard and chartKit;
  - the dashboard canvas on DashboardGrid;
  - the assistant with streaming, «توقف» and sources;
  - AI settings with a section nav;
  - the console on ConsoleCard.
- P7:
  - a members list with a side sheet;
  - the studio on the designer template;
  - the demo console with ConfirmDanger;
  - searchable help with anchors;
  - «ظاهر و چگالی» on the account page;
  - entry pages at 360 px.

**Done when.** C2-PACKAGES §1.5 holds for each package, plus the checks in §6.3, §7.3, §8.3 and §9.3:
- the event console holds 50 alerts without page scroll, and `a` acknowledges;
- the acknowledge page works signed out at 360 px;
- HR and security records stay invisible to other personas;
- the flow designer works fully from the keyboard and has an unsaved-changes guard;
- no direct recharts import outside the chart kit;
- the assistant without a model shows one setup state;
- server health renders in the server edition;
- sign-in and setup work at 360 and 1440 px in both themes.

**Depends on.** UX-1, UX-2, UX-3, UX-12.

### UX-6 · Package P8: move 1.1's forms/workflows and data-source screens onto the kit they were designed for
P1 · L · web, windows, server (data-source screens: web and server) · status: open

**Problem.** 1.1's biggest new screens were specified on the C2 templates and kit, but were built on the old kit because rd-base was never merged. They also carry a private kit: a gallery route, settings/workflows-kit, and their own ProcessCanvas beside the flows FlowCanvas and the CMDB ServiceMap. That makes three @xyflow canvases with three different chromes.

**Evidence.**
- grep finds 0 uses of ConsoleCard, WizardSteps, KpiTile, PanelCard or ConfirmDanger in `modules/{discovery,workflows}`, although design A §15 lists them.
- `workflows/kit/routes.tsx`: the Gallery route.
- `flows/FlowCanvas.tsx`, `workflows/kit/ProcessCanvas.tsx`, `cmdb/ServiceMap.tsx`.
- rd-base's ui-lint run against main:
  - workflows: font-px 85, font-floor 15, breakpoint 17, antd-table 15;
  - discovery: font-px 19, breakpoint 1.
- Only `src/ui/modules/workflows/kit/kit.css:71` sets `--xy-minimap-mask-background-color-default`. `flows/flows.css` and `cmdb/cmdb.css` keep React Flow's light default, so in dark theme their minimaps show a pale block (journal wf_7d0d5d88-cad, F6b notDone).
- RELEASE_FA:51; designs F §8 and A §15; CLICKTHROUGH.md:41-43.

**Proposal.** Redesign as specified:
- data-source console: ConsoleCard groups with a FirstRunCard;
- wizard: WizardSteps, read-only on a phone;
- connector page: the record template with a KpiRow and ConfirmDanger;
- reconciliation queue and status board: the list kit with a FilterLine;
- workflows hub: the QL template;
- process and form designers and the lifecycle editor: the DS template, sharing one designer chrome with the flow designer and the CMDB map;
- the user's «گردش‌کارها» and case pages: QL/RC with the state channel and the ActionBar;
- fold the workflows gallery into settings/style-guide.

**Done when.**
- The §1.5 DoD holds on every workflows and discovery route, crawled with the seeded sample workflow and a REST mock connector: zero blocking lint hits, light, dark and phone shots, zero serious or critical axe issues, and a vision review with no S1 or S2.
- No module-private style-guide route remains.
- In dark theme, the minimaps of the process designer, the flow designer and the CMDB map use theme tokens.
- The desktop-e2e workflow-start budget and the bank-sim push and board budgets are unchanged.

**Depends on.** UX-1, UX-2, UX-3; FEAT-1 (primary transition).

### UX-7 · F9: rename the automation flows to «جریان‌های خودکار»
P1 · M · web, windows, server · status: open

**Problem.** 1.1 ships two things called «گردش‌کارها»: the automation flows (the menu group «خودکارسازی», table labels, the access-area label) and the new form-based processes. The new F screens and the help already say «جریان خودکار», so the UI uses both names for automations. RELEASE_FA lists this as a known limit.

**Evidence.**
- `src/ui/modules/flows/index.tsx:29`, `:50`, `:52` (19 occurrences in modules/flows).
- `src/shared/tables/flows.ts:20-21`, `:58-59`, `:63`, `:67`.
- `src/shared/access/areas.ts:64`.
- RELEASE_FA:82: «دو «گردش‌کارها» در تنظیمات».
- The new name is already used in `workflows/admin/hub/model.ts:74`, `admin/process/Inspector.tsx:506` and `settings/Help.tsx:602`.
- Design F §9.4 has the inventory of about 120 labels and the seeded-text rule. Design F §12 F9 plans `src/server/modules/process/upgrade/rename.ts` and `tests/rename-flows.test.ts`; neither exists on main.
- Journal wf_7d0d5d88-cad: F9 is not done.

**Proposal.**
- One strings-only change covering:
  - UI strings, table labels and the area label;
  - server and shared messages, and the request and ESM seeds;
  - FEATURES_FA, the catalogue, RELEASE_FA and the module docs;
  - `docs/qa/clickthrough.json`.
- A one-off job, keyed in admin_config, that rewrites a seeded catalogue or ESM description only where it still equals the old seed text.
- Keys and URLs (`flows/*`) stay as they are. Journal, history and migration titles are never touched.
- It can land before UX-1, because rd-base does not touch modules/flows.

**Done when.**
- `tests/rename-flows.test.ts`, with an allow-list, finds no «گردش‌کار» naming an automation in the §9.4 files.
- The job rewrites only unedited seeds.
- Menu, palette and access screens say «جریان‌های خودکار», and old bookmarks still open.
- The RELEASE_FA limit line is removed, and the crawl is clean.

**Depends on.** —

### UX-8 · Design-quality gates in CI: lint ratchet, owners map, P0 ★ shots with axe
P1 · S · web, windows, server · status: open

**Problem.** Main's CI checks pages only for errors (clickthrough --quick). Nothing stops raw colours, sub-12 px text, non-standard breakpoints, unowned routes or accessibility regressions, and 1.1 added 21 module files with lint hits. Q's CI request was never wired.

**Evidence.**
- `.github/workflows/itsm.yml:100-126`: the clickthrough job runs `qa:crawl -- --quick`, with no qa:lint, qa:owners or shots step.
- Journal wf_ae679a62-9a5: a367db44c13f2538a notesForNext; integrator afec0a090947ab140 («still a request»).
- C2-QA §3.4.
- rd-base `package.json`: the qa:* scripts, and axe-core pinned at 4.14.0.

**Proposal.** In one push after UX-1:
1. `npm run qa:lint` and `npm run qa:owners -- --check` in the test job.
2. `npm run qa:shots -- $RUNNER_TEMP/p0-star --only '^(|todo|todo/:id)$' --renderings light,dark,phone,phone-dark` in the clickthrough job, with axe loaded from node_modules so it works air-gapped, and the images uploaded.
3. Once UX-3 closes, an axe critical or serious issue on a ★ screen fails the job.

**Done when.**
- A PR fails CI when it raises a lint count, adds an unowned route, or brings an axe critical or serious issue to a P0 ★ screen.
- Every run uploads the ★ shots.
- The job takes at most 10 minutes longer.

**Depends on.** UX-1 (UX-3 before axe fails the job).

### UX-9 · Fix the record kit's critical accessibility failures on tabbed records
P1 · S · web, windows, server · status: open

**Problem.** Record pages with module tabs fail axe at critical level, for two reasons:
- the tab list holds children that are not tabs;
- tab ids are built from Persian labels with spaces, so aria-controls is not a valid id list.

Some switches and compact buttons also have no accessible name. The tab-key code is the same on main and rd-base.

**Evidence.**
- rd-base `docs/qa/auto.json`, datasets.bank.s1 (the day-0 baseline):
  - 72 images with axe:aria-required-children on `.ant-tabs-nav`;
  - 14 images with aria-valid-attr-value on `#rc-tabs-1-tab-t1:رخداد عمده` and similar ids;
  - button-name ×4 on access/roles and incident-period-reviews/:id.
- `src/ui/records/model/layout.ts:64`: `` key: `t${i}:${label}` ``.

**Proposal.**
1. Give layout tabs ASCII keys (t0, t1, …) and keep the label for display only.
2. Keep only role=tab children inside the antd tab list; counts and «بیشتر» move outside it or into the tab label.
3. Name the unnamed switches and compact buttons.
4. Land it on main now, and keep it through UX-1.
5. Add an axe assertion for a tabbed incident record to the record-kit tests or the CI shots.

**Done when.**
- axe on incidents/:id, changes/:id, releases/:id and assets/:id, every tab, shows no aria-required-children, aria-valid-attr-value or button-name issue.
- `?tab=` deep links still work.
- The ui-records tests pass.

**Depends on.** —

### UX-10 · Visual QA release gate for 1.2 in all three editions
P1 · M · web, windows, server · status: open

**Problem.** Screens have been shot only in desktop mode on PGlite. Never shot or reviewed:
- the cloud mode (Next.js on PostgreSQL);
- the server edition's own pages (/admin/server «سلامت سرور» and /setup?token=);
- the public token pages;
- the Windows native surfaces.

The planned manual Windows checklist was never run.

**Evidence.**
- CLICKTHROUGH.md:41-43 and its «Open» list.
- C2-QA §6.1–6.3.
- No docs/qa/visual/ on any branch.
- `scripts/ui-shots-mocked.mjs:86`: /admin/server is shot only against a mocked API.

**Proposal.** Before the 1.2 release:
1. Crawl a cloud-mode server on PostgreSQL, with shots, in QA-3's job.
2. Crawl the bank-sim server installation (pack «متوسط», `--base https://kariz.bank.local`, failing on any non-local request), including /admin/server and setup.
3. Seed published links for /p/kb, /p/survey and /p/ack.
4. Run the Windows checklist on a VM (100, 125 and 150% scaling, high contrast) and file the screenshots under P7.
5. File and close findings in `docs/qa/visual/*.jsonl`, per C2-QA §5.

**Done when.** C2-QA §6.1 holds on every edition:
- zero open S1 or S2, and every S3 fixed or waived;
- axe shows zero critical or serious issues on ★ screens, in both themes;
- the crawler shows zero problems for every persona, on bank and fresh data.

docs/brand/final is re-shot from the release build.

**Depends on.** UX-4, UX-5, UX-6, UX-13, QA-3.

### UX-11 · Ship rd-base's small, self-contained user-facing fixes in the 1.1 patch line
P2 · S · web, windows, server · status: open

**Problem.** Three fixes found by the golden review exist only on rd-base:
- catalogue-item notifications end with a dangling «… مشاهدهٔ», because the renderer used the event's number;
- AI actions are offered with no model configured: the Markdown toolbar's AI menu, and the knowledge panel's «پیش‌نویس با هوش مصنوعی»;
- portal rows show record numbers in mixed script («INC۰۰۰۰۰۸۲»).

**Evidence.**
- rd-base commits:
  - ef7cac8 (VQ-P0-051): the server notify renderer and delivery, `shared/notify.ts`, the notify UI and their tests;
  - 2ba1030 (VQ-P6-049): `knowledge/ai.ts`, `routes/knowledge.ts`, `ui/ai/skills/InlineAi.tsx`, `tests/ai-not-configured.test.ts`;
  - 4778fa4 and 30496bf (VQ-P2-052): portal `parts.tsx:68`.
- Journal wf_ae679a62-9a5, round 3 (a6cd01dbabc1f02c8).
- None of their files conflicts in the dry merge.

**Proposal.** Cherry-pick the four commits, with their tests, onto a patch branch from main. The later UX-1 merge applies the identical changes cleanly.

**Done when.**
- Their tests pass on main.
- A catalogue request item's assignment notification ends «مشاهدهٔ RITM…».
- With no AI connection, no AI draft or AI menu appears.
- «درخواست‌های باز من» shows record numbers as LTR identifiers.

**Depends on.** —

### UX-12 · Windows native strings, the «ه‌ی» spellings and the splash's error state
P2 · S · windows, server, web · status: open

**Problem.** BRAND §8 orthography and C2-SPEC §3.15 are not met.
- **Spelling.** The Windows menu, a dialog, kit strings and server and local-server messages write the ezafe «ه‌ی» where it should be «هٔ». Among them is the message every outdated Windows app shows. ui-lint scans only src/ui and desktop/src, so it counts 10 of the 20 lines.
- **Splash.** The splash has no error state of its own: a failed start shows only a native dialog.

**Evidence.**
- In ui-lint's scope:
  - `desktop/src/main.ts:376` «اندازه‌ی عادی», `:379` «پوشه‌ی داده‌ها», `:550` «رایانه‌ی سرور»;
  - `src/ui/components/import.tsx:26`, `:195`, `:286`, `:303`, `:338`; `src/ui/components/data.tsx:917`; `src/ui/modules/settings/Desktop.tsx:29-30`;
  - rd-base's ui-lint run against main's tree counts heh-ye = 10 (it misses the JSX text at import.tsx:303).
- Outside it:
  - `src/server/routes/sync.ts:71`, `:124`, `:160` (OUTDATED «نسخه‌ی برنامه‌ی ویندوز …») and `:214`;
  - `src/desktop/sync-client.ts:442`, `:586`; `src/desktop/bridge.ts:33`;
  - `src/server/http/hono.ts:172`; `src/server/routes/local.ts:26`.
- rd-base `scripts/ui-lint.mjs:2` and `:63-67` (the scan roots) and `:355` (the regex `ه‌ی(?![\u0600-\u06FF])`). The same regex over every line of src/** and desktop/src/** finds exactly the 20 lines above.
- `desktop/src/main.ts:575`: the native dialog «اجرای برنامه ممکن نشد». `desktop/src/splash.html:115-125`: window.itsm offers only step, progress, status, version and ready.
- C2-INVENTORY §4.4.

**Proposal.**
1. A strings-only change for the 20 lines: desktop/src/main.ts agreed with the packaging engineer, plus the kit, server and local-server messages.
2. A repo-wide test over the string literals in src/** and desktop/src/** with ui-lint's regex, so a new one fails CI.
3. Add `itsm.error(text, logPath)` to the splash, with «نمایش گزارش» and «بستن» (static under reduced motion), and call it before the native dialog.

**Done when.**
- The repo-wide test finds no «ه‌ی» ezafe.
- The outdated-app message reads «نسخهٔ برنامهٔ ویندوز با سرور هم‌خوان نیست؛ …».
- The Windows smoke test's failure path shows the splash's error state.
- The menus read «اندازهٔ عادی» and «پوشهٔ داده‌ها».

**Depends on.** —

### UX-13 · Deterministic, complete screenshot sweeps
P2 · M · web, windows, server · status: open

**Problem.** Shots drift between renderings, or screens are never shot:
- the browser clock runs from the sweep's start time, and the server clock is not frozen;
- masks over changing content are drawn larger than it, also over overlays;
- full-page captures paint the sticky bar in the middle of the page;
- overflow tabs («بیشتر») are never opened;
- spaces/:space is in no checklist;
- one parameterised route is never reached;
- the click-through report keeps rows for shots that were removed.

**Evidence.**
- rd-base `scripts/ui-crawl.mjs:1806`: ctx.clock.install starts a running clock. VQ-Q-059: the same record reads ۲۲/۲۳/۲۶ دقیقه پیش across renderings.
- Scratchpad `vq4/notes.md`; VQ-Q-028, 029, 030 and 060 (journal wf_ae679a62-9a5).
- Integrator notes (afec0a090947ab140): `.rk-tabs-more` is missed, and spaces/:space has no template.
- Q notDone (a367db44c13f2538a): hr/journeys/:id/tracker is unreached because the pack has no journey.
- CLICKTHROUGH.md «Not reached» lists 16 routes; rd-q's seed reaches 15 of them in bank data.

**Proposal.**
1. Pause the page clock (setFixedTime or pauseAt) and give the shot server a fixed time, or mask the relative-date widgets.
2. Size masks from the element's box, and skip those under overlays.
3. Hide sticky bars in full-page captures.
4. Replay overflow tabs.
5. Add spaces/:space and the F/A routes to the checklists.
6. Drop click-through rows of removed shots.

The demo-pack journey comes from FEAT-12.

**Done when.**
- Two consecutive golden sweeps differ only inside masks.
- Zero parameterised routes are unreached in bank data.
- Every overflow tab is shot.
- CLICKTHROUGH rows match the manifest.

**Depends on.** UX-1; FEAT-12 (journey).

### UX-14 · Pins, recents and density per person, not per browser
P3 · M · web, windows, server · status: open

**Problem.** The kit keeps «نشان‌شده‌ها» (up to 7), recents and density in localStorage. They do not follow a person between the web, the Windows app and another PC, and density cannot be chosen in the account settings.

**Evidence.**
- C2-SPEC §2.7: «Server-side storage of pins/recents is a later item».
- C2-SPEC §1.4: density is chosen per person in «حساب کاربری من ← ظاهر».
- P0b notDone (a2fe7ef2dfd0ae2e5): the key `itsm.pins.<org>`.
- P0a (ae29a039cfe298231): `itsm.density`; the account-page setting is not built.

**Proposal.**
1. Keep pins, recents and density in the member's server-side preferences, synced to a linked Windows app.
2. Fall back to localStorage when offline.
3. Add «ظاهر و چگالی» to settings/account.

**Done when.**
- A pin made on the web appears in the linked Windows app and in another browser.
- Density chosen once applies everywhere.
- The defaults are compact for agents and comfortable for requesters.

**Depends on.** UX-1.

## Features and integrations (FEAT)

### FEAT-1 · Record pages honour the 1.1 form and lifecycle settings (form-hidden fields, primary and blocked transitions, definitions on Windows)
P1 · M · web, windows, server · status: open

**Problem.** In «فرم‌ها» and the lifecycle editor, administrators hide fields («پنهان در فرم»), set a primary transition («اصلی») and add conditions. The previews honour these settings; the real record page does not.
- formHidden is ignored, so a hidden field still shows on create and edit.
- Transitions are listed in module order, with no main button.
- A transition whose condition fails is not disabled; the server refuses it only after the click.
- Agents' Windows apps receive no custom_field, choice or ui_policy rows, because those live in «تنظیمات», which the agent role does not read. Their offline forms therefore lack the organisation's fields and requirements, and the server then refuses their pushes.

**Evidence.**
- `src/ui/records/model/layout.ts:36-48` never reads formHidden (grep count 0), although the server sets it at `src/server/engine/schema.ts:186`, `:226`, `:308`.
- `src/server/engine/records.ts:83`: RecordMeta.transitions is only {to, label, requires, category}.
- `src/ui/records/page/RecordHeader.tsx:24`, `:53-55`: the first 3 transitions, in order.
- `src/shared/model/lifecycle.ts:161-171` merges the overlay's primary; `LifecycleEditor.tsx:493-501` has the «اصلی» column.
- `src/shared/tables/core.ts:41`: custom_field is in area settings. `src/shared/access/builtins.ts:43-60`: the agent role grants no settings area.
- ENGINE.md §11.
- Journals:
  - wf_7b3e41ba-241: the real record page still shows form-hidden fields;
  - wf_7d0d5d88-cad: RecordHeader ignores EffectiveTransition.primary and transitionBlocked();
  - wf_37cdafce-7ad: the F1-14 gap.

**Proposal.**
1. formFields and the UI policies skip formHidden fields on create and edit forms only. Lists, filters, boards and exports stay as they are.
2. RecordMeta.transitions carries primary, when/whenMessage and needs. RecordHeader renders the primary transition as the main button, disables a blocked one with its message (transitionBlocked from `@shared/model/lifecycle`), and prompts for needs.
3. Definition rows (custom_field, choice, ui_policy) replicate to every account that reads the table named in table_key. Writes to them stay web-only.

**Done when.**
- A field hidden in «فرم‌ها» disappears from the record's create and edit forms (web and Windows) and still shows in lists, filters and exports.
- Marking a transition «اصلی» makes it the only filled header button (test).
- A transition whose condition fails is disabled, with the condition's message.
- An agent-role Windows app shows the organisation's fields, enforces a «فقط کارشناسان» requirement offline, and its push is accepted.
- Each new test fails without its change, and the crawl and desktop-e2e are green.

**Depends on.** — (it lands on the new kit if UX-1 merges first).

### FEAT-2 · ITAM's software sync must read everything before it deactivates installs
P0 · S · web, windows, server · status: open

**Problem.** syncInstalls reads at most:
- 100,000 live runs_on relationships of any class, and only then keeps the software → computer pairs;
- 100,000 computers with an OS;
- 5,000 software models;
- 200,000 existing installs.

It then marks every active «discovery» install it did not see as removed, and existing installs beyond the first 200,000 are never deactivated.

The cap is reachable in 1.1 already. The vCenter connector writes a runs_on relationship for every VM → host pair, so in a bank estate with many VMs the first 100,000 relationships by id are largely VM → host rows, and software → computer pairs past them are never read. The read also pages by OFFSET in separate statements, so relationships closed during a pass shift the pages and skip rows even below the cap. Each pass then deactivates the installs it happened not to read: licence positions flap and are understated, which is silent data corruption in the module banks use for licence audits.

The same caps appear in renormalize, and the licence position pass reads at most 500,000 active installs.

**Evidence.**
- `src/server/modules/itam/sam.ts`:
  - `:27`: live ci_rel of type runs_on, limit 100000, ordered by id only (liveRows' default);
  - `:34-37`: the software → computer filter runs after the read;
  - `:42`: computers with an OS, limit 100000;
  - `:48`: models, limit 5000;
  - `:49`: existing installs, limit 200000;
  - `:89`: `gone` = active existing installs not seen; deactivated at `:90-95`;
  - `:100-101`: renormalize's caps;
  - `:126-128`: the licence pass: models 5,000, entitlements 50,000, active installs 500,000.
- `src/server/modules/incident/common.ts:52-60` and `src/server/engine/read.ts:40-46`: liveRows reads `order by t.id` in OFFSET pages, each page its own statement on `sys.db`.
- `src/server/modules/discovery/mapping.ts:12`: PARENT_REL = "runs_on"; `src/server/modules/discovery/connectors/vcenter.ts:6`: each VM gets runs_on its host.
- Design A §11.2, the integrator note: a paged syncInstalls rewrite is needed.

**Proposal.**
- Filter the relationship read in SQL to software parents and computer children.
- Read every list with keyset pagination by id, so pages never shift.
- Deactivate only what a complete pass did not see; an interrupted pass deactivates nothing and resumes through `{ again }`.
- Remove the caps from renormalize and the licence pass (`:128` included) in the same way.

**Done when.**
- syncInstalls over more than 150,000 runs_on relationships deactivates nothing that still exists.
- With 120,000 VM → host runs_on rows and 1,000 software → computer rows, syncInstalls deactivates nothing that still exists.
- An interrupted pass leaves every install's state unchanged.
- Licence positions equal an exact count in a 250,000-install test.

**Depends on.** —

### FEAT-3 · Endpoint and inventory connectors moved to 1.2: Kaspersky Security Center, AD computers, Endpoint Central, GLPI
P1 · L · web, server · status: open

**Problem.** The endpoint tools most common in Iranian banks are notBuilt stubs:
- Kaspersky Security Center (very high prevalence);
- Active Directory computers (universal);
- ManageEngine Endpoint Central (high);
- GLPI.

The wizard hides them, and creating one is refused, so banks must script push batches. Most endpoints therefore never reach the CMDB and ITAM with a tool's last contact, so stolen or dead machines go unflagged.

**Evidence.**
- Stubs: `src/shared/discovery/kinds/{ksc,ad_computers,endpoint_central,glpi}.ts` (ready:false through `kinds/base.ts:9`).
- `src/server/modules/discovery/connectors/{ksc,ad_computers,endpoint_central,glpi}.ts:7` call notBuilt («هنوز ساخته نشده»; `kind.ts:109`, `:136-138`); creation is refused at `config.ts:77`.
- RELEASE_FA:52; discovery_FA:183-189.
- Design A: §2.1–2.2 (prevalence), §10 (contact, the 14-day AD lag), §14.8 (bind-account approval, fixed filter and attributes), §24 DA3a/DA3b.
- PLAN.md: the owner decision of 08:40 Nov 14. Journal wf_5839f373-45b.

**Proposal.** Build per design A:
- KSC through its OpenAPI: Session.StartSession, HostGroup.FindHosts with ChunkAccessor paging, KLHST_WKS_LAST_VISIBLE as the contact time, and protection status shown as «هشدار».
- AD computers:
  - through the existing LdapClient, only after an integrations administrator approves;
  - a fixed filter and fixed attributes (no LAPS, no description);
  - a run-log row for each pull.
- Endpoint Central: page/pagelimit paging, with detail calls only for changed scans.
- GLPI: the legacy REST API (App-Token + session, Range paging) and API v2 (OAuth2).

For each kind:
- a mock in tests/mocks/discovery/;
- a discovery-kinds test;
- troubleshooting text in discovery_FA.

Then remove the 1.2 exclusions from tests/discovery-docs.test.ts. AD and KSC default to the create_policy «ساخت پس از بررسی».

**Done when.**
- The design A DA3a/DA3b acceptance passes against the mocks:
  - paging and the contact fields;
  - AD is used only after approval and never shows the bind password;
  - a KSC host that is listed but silent counts as no contact;
  - the AD 200-day dead-machine fixture yields a missing-asset task.
- The wizard offers all four kinds.
- discovery-docs passes without exclusions.
- The discovery crawl is clean for all three personas.

**Depends on.** FEAT-7 (the real-instance method); FEAT-10 for web organisations with on-prem tools; the owner's answer on the target banks' tools.

### FEAT-4 · MECM (SCCM) connector with Windows-integrated authentication
P1 · L · server · status: open

**Problem.** MECM's AdminService is the authoritative hardware source in Windows estates, but it accepts only Kerberos/NTLM. Kariz has no client-side Windows authentication, so this source cannot be connected at all.

**Evidence.**
- Stub `kinds/mecm.ts` (auth windows_identity/ntlm; editions server and relay); `connectors/mecm.ts:7` calls notBuilt.
- There is no `src/server/modules/discovery/winauth/` directory.
- node-expose-sspi ships (package.json:77) but is used only for server-side SSO (`src/server/auth/sso.ts:54-80`).
- The hardened PowerShell runner exists as groundwork (`src/server/modules/discovery/psrun.ts`).
- Design A §6.4 and §24 DA3b; RELEASE_FA:52.

**Proposal.** Add `winauth/{sspi,ntlm,md4,powershell}.ts` per design A §6.4:
- in-process Negotiate through node-expose-sspi, as the KarizApp account or a gMSA;
- pure-JS NTLMv2 with an MD4 implementation;
- a PowerShell fallback through psrun with `-MaximumRedirection 0`, the host checked first.

The MECM kind:
- chunks by ResourceID ranges with $filter and $select;
- picks the class by chassis and OS;
- takes contact from LastActiveTime;
- identifies machines by BIOS GUID and serial.

Document running KarizApp as a domain account in SERVER_FA and discovery_FA.

**Done when.**
- NTLMv2 matches published test vectors.
- Negotiate works on the Windows CI runner, or a documented skip applies when the module is absent.
- The PowerShell fallback refuses a redirect to another host before any credential is sent.
- The MECM mock passes chunked paging, identity and contact.
- Allow-list refusals keep their documented Persian messages.

**Depends on.** FEAT-7.

### FEAT-5 · SQL Server view connector (sql_view) for the ATM switch's terminal status
P1 · M · server · status: open

**Problem.** The bank's ATM availability KPI and contractor penalties depend on device_status. No ATM vendor offers a public API, and the switch's monitoring view in SQL Server is the most common source a bank can reach. In 1.1 a bank must schedule CSV exports (feed) or script the push API.

**Evidence.**
- Stubs `kinds/sql_view.ts` and `connectors/sql_view.ts:7` (notBuilt).
- Design A §6.5 (a fixed parameterised query, identifier validation, the password on stdin, Encrypt=True) and §24 DA3c.
- Journal wf_5839f373-45b: sql_view "moved to 1.2 … The LocalDB check on the Windows runner moved with it".
- RELEASE_FA:52.

**Proposal.** Add sqlview.ts and the connector per design A §6.5:
- read through psrun with System.Data.SqlClient;
- page by a cursor column, or by OFFSET/FETCH on the key;
- map rows to DiscoveredRecord, with device_status_map feeding the existing ATM hysteresis;
- authenticate with the KarizApp identity, or with a SQL login whose password goes on stdin.

**Done when.**
- Identifier-validation and query-building tests pass on every platform.
- A Windows-runner test reads a LocalDB view and drives an ATM's device_status after the hold and two polls, stamped at the tool's time.
- The password never appears on a command line or in run errors.
- A host that is not on the allow-list is refused with the documented message.

**Depends on.** FEAT-4 (Windows identity); the owner's answer: SQL Server or Oracle switch.

### FEAT-6 · Software inventory from data sources and the SAM feed
P1 · L · web, server · status: open

**Problem.** Software collection from tools, the SAM feed and the «نرم‌افزار یکسان‌نشده» tab of «صف آشتی» moved to 1.2. Licence compliance therefore has no software inventory from MECM, KSC, Endpoint Central or GLPI. The discovery_software staging table exists, but nothing writes it.

**Evidence.**
- `src/server/modules/discovery/itamfeed.ts:22`: «Software staging and the SAM feed (§11.2) come with release 1.2».
- `src/shared/tables/discovery.ts:339`: discovery_software, unused.
- Journal wf_5839f373-45b: software staging, the SAM feed, «نرم‌افزار یکسان‌نشده», the 1M-row scale test and licence reconciliation moved to 1.2.
- Design A §11.2 / DA7; discovery_FA:189.

**Proposal.** Per design A §11.2:
- stage each device's software set-based in discovery_software, re-staged only when its software_hash changes;
- feed only installs that match a software model into software_install (source=import);
- roll up unmatched names in «نرم‌افزار یکسان‌نشده», with «ساخت مدل نرم‌افزار»;
- collection is off by default, and only a software manager can switch it on.

**Done when.**
- A device's software list replaces its previous list.
- Only matched installs reach software_install, and the syncInstalls rows are untouched.
- The 1,000,000-row staging test passes, and a 1% change writes 2,500 install rows or fewer.
- Licence reconciliation counts the fed installs.

**Depends on.** FEAT-2; FEAT-3 and FEAT-4 for sources that report software.

### FEAT-7 · Check the Zabbix, PRTG and vCenter connectors against real instances; add the discovery bank-sim scenario
P1 · M · server, web · status: open

**Problem.** The three pulled connectors of 1.1 were checked only against vendor docs and recorded mocks. Four field meanings that decide status, contact and identity are unverified. A wrong one means wrong «قطع» or «برقرار» states, wrong contact times or duplicate CIs at a bank. bank-sim covers only the push API: there is no LAN Zabbix with the bank CA, no drop-folder feed, and no check of the allow-list refusal.

**Evidence.**
- Journal wf_5839f373-45b: still marked to verify are PRTG filter_parentid, PRTG lastup_raw as UTC, the vCenter 8.0 identity.bios_uuid, and the VMware serial byte order.
- PLAN.md 14:00 entry, open item (3).
- Code: `connectors/prtg.ts:115`, `:146`; `connectors/vcenter.ts:122`, `:212`.
- BANK_SIM_FA:7: scenario 13 is push only. scripts/bank-sim/ has no discovery mock.
- Design A §17 (B0) and DA5.

**Proposal.**
- Run each connector once against a real Zabbix 6.0/7.0, PRTG 24.x and vCenter 7/8. Record sanitised fixtures, fix any mismatch, and pin the fixtures in the mocks.
- Add a bank-sim scenario:
  - the Zabbix mock on the LAN IP with a certificate from the bank CA, allowed by exact name;
  - a Zabbix connector created through the API;
  - an ATM switch CSV dropped into a feed connector's folder;
  - a connector pointed at a host that is not on the allow-list.

**Done when.**
- The four fields are confirmed or corrected, with fixture-backed tests.
- The scenario passes on the Windows runner:
  - hosts become CIs, and assets after confirmation;
  - an ICMP flip shows «قطع» and opens an alert, while a disk trigger shows «هشدار»;
  - the ATM CSV sets device_status after the hold;
  - the host that is not allowed fails with the documented message.
- discovery_FA records one run per vendor.

**Depends on.** Owner: access to the vendor instances.

### FEAT-8 · A catalogue item can start an admin-built workflow
P1 · M · web, windows, server · status: open

**Problem.** The headline of 1.1 is administrators drawing workflows with organisational roles, such as «درخواست دسترسی به سامانه». Employees, however, look for services in the catalogue and portal, and no catalogue item can start a workflow. People must use the separate «گردش‌کارها» start list, so there are two front doors, and catalogue entitlement, search and the virtual agent's ordering do not apply to workflows.

**Evidence.**
- Design F §10: «A catalogue item that starts a process instead of a request. The hook point is ready (trigger kind `process`); P2 wires it later».
- No process reference in src/server/modules/request or src/shared/tables/request.ts; grep finds 'process' only as the OS process in comments.
- Workflows start only from the workflows pages (workflows_FA, part two).

**Proposal.**
- An item type «گردش‌کار» that names a published process.
- Ordering it maps the answers onto the start form, or opens the start form, and creates the case with startCase.
- The request item links to the case, with its state mirrored for «کارهای من».
- Entitlement and starters both apply.
- The virtual agent offers such items the same way.

**Done when.**
- A portal user orders «درخواست دسترسی به سامانه (نمونه)», and a case starts at «ثبت درخواست» with the answers carried over.
- A person who is not among the starters cannot order it.
- The case shows in «کارهای من», and the item page links to it.
- Tests cover web and a linked Windows app (where the start is queued until sync).

**Depends on.** —

### FEAT-9 · AI skills as steps of automation flows and workflows
P1 · M · web, windows, server · status: open

**Problem.** The flow designer's palette offers the node «مهارت هوش مصنوعی», but no skill is ever registered for flows. The inspector says «مهارتی نصب نیست», and a stored step logs «… هنوز نصب نیست؛ این گام کاری نکرد» and does nothing. Classification, summary or routing by the organisation's own skills therefore cannot be automated in flows or workflows. The catalogue rates this capability P0 (AI-079).

**Evidence.**
- `src/server/modules/flows/registry.ts:164`: registerFlowSkill has no caller anywhere in src (grep).
- `src/server/modules/flows/nodes.ts:304-316`: the no-op handler.
- `src/shared/flows/nodes.ts:340-352`, `:369-372`: the node is in PALETTE.
- `src/ui/modules/flows/Inspector.tsx:103-112`.
- AI.md §17; FEATURES_FA:2334 (AI-079, P0) and :2246.

**Proposal.**
- Register the published skills that suit automation through registerFlowSkill, with typed inputs and outputs.
- Run them as the flow's run-as principal, with the same data policy, limits, guard log and proposal semantics. A field change is a proposal unless the agent's auto-apply allow-list covers it.
- Offer the same step in the process designer through the subflow node.
- Hide the node when AI is not configured.

**Done when.**
- A flow that runs «پیشنهاد دسته» on a new incident writes the skill's output into flow variables and records the run in the skill's run log, under the run-as identity.
- A table under the policy «هرگز» is refused, with a guard-log entry.
- With no model, a skill that has a rule-based answer still runs, and the rest are skipped with a Persian log line.
- Tests cover the web edition and the server edition.

**Depends on.** —

### FEAT-10 · Kariz relay so the web edition can reach tools inside the organisation's network
P2 · L · web · status: open

**Problem.** The web edition's connectors reach only public HTTPS hosts. For on-prem Zabbix, vCenter, KSC or AD, a cloud organisation can only script the push API or webhooks; no pulled connector works.

**Evidence.**
- There is no `src/relay/` and no `scripts/build-relay.mjs`.
- Kinds already declare the edition 'relay' (for example `src/shared/discovery/kinds/zabbix.ts:17`), and `src/shared/discovery/kinds.ts:35` lists the kinds a relay can run.
- RELEASE_FA:52; discovery_FA:187.
- Design A §13 and §24 DA6.
- The owner's default is the relay in the second wave (PLAN.md, 16:45Z Nov 11).

**Proposal.** Per design A §13:
- a single kariz-relay.mjs, built with esbuild from the shared connector code, needing only Node 22 built-ins;
- configuration in relay.json, and relay.secrets.json readable only by the relay's account (icacls or 0600);
- a host pin with no redirects;
- pushes as snapshots of up to 500 records, plus status;
- a 7-day spool on disk;
- an integration key with only the discovery_item create scope;
- `docs/modules/discovery_relay_FA.md` and release assets.

**Done when.**
- The bundle runs on Node 22 with built-ins only (DA6 acceptance).
- Zabbix, vCenter and REST mocks are relayed to a local server as snapshots and status.
- A secrets file readable by others is refused, and no redirect is followed.
- The spool survives a restart.
- A key without the scope gets 403.

**Depends on.** FEAT-3 and FEAT-4 for the relayed kinds.

### FEAT-11 · Filter, sort and report on workflow case values
P2 · L · web, windows, server · status: open

**Problem.** Workflow cases keep their values in one hidden json field. Lists, filters, analytics reports and exports cannot use them, so questions such as «درخواست‌های دسترسی به سامانهٔ X در این ماه» or the average approval time per branch cannot be asked. A bank's compliance reporting on these processes then has to be done outside Kariz.

**Evidence.**
- `src/shared/tables/process.ts:198`: process_case.data is a json field marked system, hidden, audit:false.
- No reference to process_case in src/shared/analytics or src/server/modules/analytics (grep).
- Design F §10.

**Proposal.**
- Expose a published version's form fields as per-process report fields. Two possible routes: a generated view per process, or an indexed projection of scalar values written by the authority at apply.
- Either way, apply each viewer's redaction exactly as case detail does (caseViews/visibleData).
- Add the fields to the report builder and to list filters for a chosen process.

**Done when.**
- A manager's report «پرونده‌های «درخواست دسترسی» به تفکیک سامانه و واحد» returns correct counts.
- A field hidden from a viewer at every step never appears in their report, filter or export.
- Confidential processes stay out of non-participants' reports.
- Performance is within budget on 100,000 cases.

**Depends on.** —

### FEAT-12 · Complete the bank demo pack: data sources and the modules it still lacks
P2 · M · web, server (data sources); all editions for the other samples · status: open

**Problem.** The «بانک نمونهٔ آفتاب» demo creates no data source, so «منبع‌های داده», «صف آشتی» and «وضعیت پایش» are empty in a presentation. It also has none of these:
- an HR employee journey (so the journey tracker page is never reached, even by the crawl);
- a periodic SLA review or penalties;
- a policy attestation campaign;
- audits;
- AI agents;
- messenger channels.

A real member's case of the demo workflow survives the purge with a dangling reference; that needs an owner decision.

**Evidence.**
- No connector is created in src/server/modules/demo (grep), and `src/server/modules/discovery/connectors/demo-data.ts` does not exist.
- `connectors/demo.ts:1-3`: «DA5 replaces the fixture below with the pack's own servers, branches and ATMs».
- RELEASE_FA:83; DEMO_FA:83.
- Journals:
  - wf_ae679a62-9a5: hr/journeys/:id/tracker is unreached;
  - wf_7d0d5d88-cad note 3: the surviving case; DA5's demo connector is not built.

**Proposal.**
- Add connectors/demo-data.ts, built from the pack's own servers, branches and ATMs, with status flips. The pack creates a demo connector inside the demo scope, and its items, runs, states and queue item purge with no trace.
- Add small, complete samples for:
  - journeys (onboarding and offboarding);
  - SLA reviews with penalties;
  - an attestation campaign;
  - an audit with findings;
  - one agent in test mode (no outbound calls);
  - a messenger channel record (never sending).
- Then remove the RELEASE_FA and DEMO_FA limits.

**Done when.**
- After loading, «وضعیت پایش» shows down, up and ATM states, and «صف آشتی» has an item.
- The new pages open as the pack's personas, and the crawl reaches hr/journeys/:id/tracker.
- demo-purge (PGlite and real PostgreSQL) proves zero trace with no new exceptions.
- The delivery and outbound guard tests pass.

**Depends on.** The owner's decision on demo-workflow cases.

### FEAT-13 · Assistant tools for monitoring status and known-issue detection before a report
P2 · M · web, windows, server · status: open

**Problem.**
- FINAL-7 rightly made discovery_state unreadable through the record API, but nothing replaced it for the assistant. The assistant cannot answer «کدام خودپردازهای شعبهٔ ۱۰۲ قطع‌اند؟» or use monitoring status when triaging.
- The virtual agent never checks open problems and known errors before a requester reports, so it cannot deflect reports like «سامانهٔ X از کار افتاده». The catalogue rates that capability P0 (AI-067).

**Evidence.**
- `src/shared/tables/discovery.ts:200-201`: discovery_state read is NEVER.
- `src/server/modules/ai/tools/records.ts:105-107`.
- No AI tool reads statusBoard (grep); `cmdb/ai.ts` offers only cmdb_impact_of, cmdb_dependencies, cmdb_path_between and cmdb_ci_summary.
- discovery_FA «جزئیات فنی»; RELEASE_FA:47.
- src/server/modules/ai/va never reads known_error (grep).
- AI.md §17; FEATURES_FA:2322 (AI-067, P0); fin-srv note 3 (journal wf_b73ae1aa-c4e).

**Proposal.**
- A read-only `monitoring_status` tool over statusBoard and statusPanel (`src/server/modules/discovery/status.ts`), under the reader's own rules:
  - a branch officer gets own-branch status without tool names;
  - it never returns another CI's tool text (as FL-1);
  - AI canary tests cover it.
- In the virtual agent's report flow, match the description against open major incidents, problems and published known errors the requester can read, and offer «همین مشکل است» to follow that record instead of filing a duplicate.

**Done when.**
- The assistant lists the ATMs that are down for a CMDB reader, and gives nothing to a requester.
- A branch officer sees only own-branch rows, without tool text.
- With an open known error about «VPN», a requester typing «VPN وصل نمی‌شود» is offered it before submitting; following it records a deflection and creates no incident.
- Access tests fail without the read rules.

**Depends on.** —

### FEAT-14 · AI governance leftovers: confidence thresholds, undo of agent actions, approval routing, injection detection
P2 · L · web, windows, server · status: open

**Problem.** Several governance pieces of the AI layer are missing:
- a per-skill confidence threshold, or abstention;
- an undo journal for actions an agent applied;
- routing agent proposals through the approvals service (today they are notified);
- a prompt-injection classifier beyond data framing.

For a bank, auto-applied AI actions without undo are a weak control.

**Evidence.**
- AI.md §17 «Not built yet».
- FEATURES_FA:2246 (AI-158, planned) and :2415 (AI-160, half-built).
- The daily-limit race (A2-40) is in QA-2b.

**Proposal.**
- A calibrated confidence for each skill output, with a threshold below which the skill abstains with a Persian reason.
- An undo journal for each applied agent action: the previous field values, and «برگرداندن» with the actor's rights, audited.
- Agent proposals on records that carry an approval rule go through requestApproval.
- A lightweight injection classifier whose result goes to the guard log.

**Done when.**
- Below the threshold, the skill returns abstained with no proposal.
- An auto-applied agent change can be undone to the exact previous values by a person with write rights, and the undo is audited.
- An agent proposal on a change with an approval rule creates an approval.
- An injection-like record text is flagged in the guard log.

**Depends on.** —

### FEAT-15 · Link field-service work orders to ITAM assets
P2 · M · web, windows, server · status: open

**Problem.** A field-service work order names its asset only as free text. Engineers' visits to an ATM or branch device therefore:
- do not show in the asset's history;
- cannot use its warranty, contract or contractor penalty;
- are not validated against ITAM.

A maintenance plan can name a CI, but the work orders it creates cannot name an asset.

**Evidence.**
- `src/shared/tables/field_service.ts:108`: work_order.asset_ref is a string.
- work_order has no ci or asset reference; maintenance_plan.ci_id is at `:395`.
- Journal wf_51d4be9c-ad8: asset_ref is free text and is not validated against ITAM.

**Proposal.**
- Add asset_id (a reference to asset, with branch-scoped picking) and ci_id to work orders, keeping asset_ref as legacy text.
- Resolve asset_ref to the asset when ITAM is installed.
- Show work orders on the asset and ATM fleet pages.
- Coverage and entitlement come from the asset's contract.
- Bump SYNC_PROTOCOL for the new synced columns.

**Done when.**
- A work order created from an ATM's page carries its asset_id and appears in the asset's history.
- Coverage comes from the asset's maintenance contract.
- A branch officer can only pick own-branch assets.
- Existing work orders migrate, with asset_ref matched where it is unique.
- Windows sync round-trips the new fields under the bumped protocol.

**Depends on.** —

### FEAT-16 · Agent productivity against mature service desks: split incidents, macros, incident checklists
P2 · M · web, windows, server · status: open

**Problem.**
- Agents can merge duplicate incidents but cannot split one that mixes two issues.
- «پاسخ‌های آماده» insert text only: no macro sets fields, adds a note and moves the state in one click.
- Incidents have no checklists, although change, request, knowledge and field service have them.

The catalogue rates split and macros P0.

**Evidence.**
- FEATURES_FA:457 (INC-018 «ادغام؛ بدون تفکیک»), :463 (INC-024 «پاسخ آماده؛ بدون ماکرو») and :436 (INC-016 checklists, planned).
- No split route in src/server/modules/incident, and no macro (grep). `src/ui/modules/incident/index.tsx:153` has «پاسخ‌های آماده».
- Checklists exist in `src/shared/tables/{change,request,knowledge,field_service}.ts`, not in incident.ts.

**Proposal.**
- «تفکیک رخداد»: copy the chosen fields, move the selected comments and attachments, link parent and child, and run the SLA from the new record's own clock.
- Macros: a named set of field values, a note and a transition, limited to the agent's write rights, with an audit trail.
- Incident checklists from templates, with «بستن» blocked until the required items are done.

**Done when.**
- Splitting creates a linked incident with the chosen comments moved, and the SLA timers start correctly.
- A macro applies its writes in one transaction with the agent's rights, and is refused on fields the agent cannot write.
- An incident from a template with a checklist cannot be resolved until the required items are ticked.
- The Windows app supports these offline wherever the push guards allow.

**Depends on.** —

### FEAT-17 · Second wave of monitoring and inventory connectors; syslog and SNMP event intake
P2 · XL · server, web · status: open

**Problem.** Design A rates ManageEngine OpManager and ESET PROTECT «high in Iran», but they have no connector. Neither do SolarWinds, Nagios XI/Icinga, Prometheus, NetBox, OCS, SCOM, Hyper-V/SCVMM, Intune or Lansweeper. Event management has no syslog or SNMP-trap intake, so branch network gear must go through Zabbix or PRTG.

**Evidence.**
- Design A §2.2 (the second wave and its order), §21 Q4 (an SNMP library needs the owner's approval) and §24 (10–11 sessions).
- FEATURES_FA:593: EVT-002 is half-built, «بدون SNMP، syslog، OpenTelemetry …».
- No syslog or SNMP code in src/server/modules/event (grep).

**Proposal.**
1. OpManager (with its event format) and ESET PROTECT 13+ first.
2. Then NetBox as a first-class kind.
3. Nagios, Icinga, Prometheus, LibreNMS and Checkmk, status first.
4. SCOM and Hyper-V through psrun, then OCS.
5. Syslog over TCP/TLS and UDP on the server edition, as an event source.
6. SNMP only after the owner approves the library.
7. Padvish through feed or push until its vendor documents an API.

**Done when.**
- Each kind passes its design A mock tests (paging, availability rules per §9.2, contact, errors) and is offered in the wizard with its docs section.
- Syslog messages become events, with the source's rate limit and maintenance windows.
- The air-gap allow-list applies to every new outbound host.

**Depends on.** FEAT-7; the owner's answers to design A §21 Q1 and Q4.

### FEAT-18 · Workflow version-2 capabilities deferred by design F
P3 · L · web, windows, server · status: open

**Problem.** Design F lists capabilities that are not in version 1 and that mature workflow tools offer:
- moving open cases to a newer version;
- calculated fields and formulas;
- named alternative forms of a table, such as a short intake form for phone agents;
- foreign-currency amounts;
- adding or removing states of studio tables;
- ESM journeys running on workflows;
- hiding a process from people who may not start it;
- claiming and manager actions offline;
- a required «پیوست» field that can be filled while the record is still being created.

**Evidence.**
- Design F §10: «Not in version 1».
- `src/ui/modules/workflows/kit/FilesInput.tsx:187`.
- Journal wf_7b3e41ba-241: a required «پیوست» field cannot be filled while a record is being created.
- workflows_FA:125: claiming and managers' actions need a connection.

**Proposal.** Plan these as a version-2 package, each item with its own design review, in this order:
1. version migration of open cases, with a mapping of steps;
2. calculated fields;
3. alternative forms;
4. attachments staged before create;
5. hiding processes from people who may not start them;
6. ESM journeys moved onto workflows;
7. the remaining items.

**Done when.**
- A design addendum with packages and estimates exists.
- The first two items are built with tests: a case on v2 moved to v3 keeps its values and has its step mapped, and a calculated field is recomputed on apply and in the preview.

**Depends on.** FEAT-11 (the shared value projection).

### FEAT-19 · Close the feature catalogue's open P0 capabilities, module by module
P1 · XL · web, windows, server · status: open

**Problem.** The owner asked for every ITSM/ESM module of the feature catalogue, but before this item the roadmap named only 15 catalogue IDs, several of them only as DOC-4's samples. By the catalogue's own status blocks, 145 P0 capabilities are half-built or planned, and 161 more have no status of their own. No item plans the remaining core work of these modules:
- incident;
- request and portal;
- change;
- knowledge;
- analytics;
- events and SLM;
- access and platform.

**Evidence.** A read-only parse of `docs/FEATURES_FA.md`'s status blocks against its tables (main, 15 Nov):
- 641 P0 rows:
  - 335 listed built;
  - 129 half-built («نیمه‌کاره»);
  - 16 planned («برنامه‌ریزی‌شده»);
  - 161 with no status of their own: 154 in no status line at all (ACC 66, PLT 57, AI 20, SLM 11), 6 only «در ماژول‌های دیگر» or «از سکو و ماژول‌های دیگر» (ADM-006, INT-015, INT-016, INT-040, WFM-001, WFM-008), and WFM-026 «ساخته‌نشده».
- Half-built P0s by module: INC 19, ANA 14, AI 14, REQ 13, KB 10, EVT 8, CHG 7, ADM 5, SLM 5, and 34 more across 16 modules.
- Planned P0s with no roadmap item (the 16th, AI-158, is in FEAT-14):
  - INT-008, typed connector actions (`:231`);
  - INC-011 smart triage (`:450`), INC-037 KCS (`:476`), INC-042 portal report with suggested solutions (`:481`);
  - INC-067 status summary, INC-068 resolution note, INC-069 reply drafts and INC-077 AI transparency (`:506-516`);
  - REQ-056, conversational ordering (`:787`);
  - PTL-020 e-mail channel (`:834`), PTL-032 access and sign-up modes (`:846`), PTL-044 multilingual (`:858`);
  - CHG-068, change summary (`:1147`);
  - ANA-019, time in each state (`:1967`; grep finds no time_in_state or «زمان در هر وضعیت» in src), and ANA-037, the continual-improvement register (`:1985`).
- INT-042, migration from OTRS/Znuny, GLPI, iTop and others with history (`:265`, P1), is half-built with CSV and Excel import only (`:218`).

**Proposal.**
1. DOC-4 (raised to P1) runs first and corrects the statuses from the code.
2. From its recount, one package per module group for every P0 still half-built or planned, plus the P1s the owner picks, INT-042 first.
3. Each package names its catalogue IDs in its tests. The owner may defer an ID only with a reason recorded in FEATURES_FA.
4. Order by bank value:
   - incident, request, portal, change and knowledge;
   - then analytics, events and SLM;
   - then access and platform.
5. A module's package follows its UX-4 or UX-5 package, which owns the same UI files.

**Done when.** After the packages, the recount shows:
- no P0 marked «برنامه‌ریزی‌شده»;
- every P0 «نیمه‌کاره» built, or deferred by the owner with a reason in FEATURES_FA;
- a status line for every ACC and PLT P0;
- a test named after each closed ID.

**Depends on.** DOC-4; the owner's scope (open question 15); UX-4 and UX-5 per module.

### FEAT-20 · Official holiday calendars beyond 1406, and a warning before they run out
P1 · S · web, windows, server · status: open

**Problem.** Business time for SLAs, on-call, change windows and forecasts uses the bundled Iranian holidays.
- They stop at 1406, whose last day is 19 March 2028, and 1406's lunar dates are predictions.
- After that, holidays count as working days unless an administrator enters them by hand.
- An existing organisation gets a newly bundled year only through the manual seed.
- Air-gapped banks cannot fetch the dates, and nothing warns.

A bank that installs 1.2 in 2027 meets this within a year.

**Evidence.**
- `src/server/modules/sla/holidays-ir.ts:1-5` (bundled years 1404–1406; 1406's lunar dates are predicted), `:108` (the last date, 1406-12-29 = 2028-03-19) and `:113` (IR_HOLIDAY_YEARS).
- `src/server/modules/sla/calendars.ts:135-142`: a year is seeded once; the seed runs for a new organisation (`src/server/modules/sla/index.ts:35`) or on POST /seed (`src/server/routes/sla.ts:46-52`).
- `src/server/routes/sla.ts:44`: the /bundled route. grep finds no other use of IR_HOLIDAY_YEARS, so nothing warns.

**Proposal.**
- Ship each new year's official list in every release, and seed it into existing organisations on upgrade; the seed already skips years seeded once and dates added by hand.
- Warn in «سلامت سرور», the platform console and the calendar page six months before an organisation's last holiday year ends.
- An offline import of the official calendar, in the UI and as `karizctl holidays import`.
- A «تأیید» flow for predicted lunar dates.

**Done when.**
- A fake-clock test in 1406-07 shows the warning.
- An upgrade adds 1407 to an existing organisation and keeps its edited 1406 rows.
- The import works on an air-gapped server.

**Depends on.** —

### FEAT-21 · Full data exports past the 10,000-row cap
P2 · M · web, windows, server · status: open

**Problem.** Every data export and list export reads at most 10,000 rows per table and only marks the result as truncated. At bank volume (millions of incidents), Kariz cannot produce an auditor's or regulator's full export of incidents, changes or assets.

**Evidence.**
- `src/server/engine/transfer.ts:73`: exportRows clamps the limit to 10,000.
- `src/server/modules/admin/exports.ts:82`: each table of a data export is read with limit 10_000; `:84` records stats.truncated.
- `src/server/routes/records.ts:203`, `:208`: list exports use the same exportRows.

**Proposal.**
- Stream each table in keyset pages into the export file, inside a resumable job (`{ again }` with saveIn progress).
- Keep the reader's access and the demo filter exactly as they are.
- Show a size estimate before the start, and progress on the export row.
- Keep the 10,000 cap only for synchronous list downloads, which then offer the background export.

**Done when.** On the PERF-2 data, a 1,000,000-row export:
- completes;
- equals an exact count under the reader's access (test);
- survives a restart mid-way.

**Depends on.** PERF-2 (the data).

## Quality and tests (QA)

### QA-1 · Run 117's desktop-e2e failure: confirm the 1.1.1 fix and make the performance gates trustworthy
P1 · M · windows, server · status: open (root-cause fix in PR #53, draft at writing)

**Problem.**
- **Run 117.** On the release commit, desktop-e2e failed once (admin API p95 2,766 ms against 2,000) and passed on the re-run (746 ms). PR #53 (1.1.1) attributes the failure to PGlite's synchronous first opens of database files, held by Windows on the first page after setup. It adds a re-open pass and a stall watch, but the fix still has to be confirmed by evidence over several runs.
- **Gates in general:**
  - the 1.1 budgets rest on one or two Windows runs;
  - several server budgets are far looser than their own baselines;
  - desktop-e2e can write a report that says every check passed after the scenario crashed;
  - no form's create or edit is timed.

**Evidence.**
- Run 43696253020:
  - job 132764044988: «FAIL admin: API as the renderer saw it, 95th percentile (ms): 2766 (budget 2000)»;
  - job 132781870599 (attempt 2): 746 ms, 67/67.
- PR #53's description: four other Windows runs measured 321–411 ms and Linux 170–250 ms; on the slow machine, the template unpack took 6.8 s and the setup 4.1 s.
- Journal wf_80b85438-f3e: re-base the three new budgets at 2–3× the median of several Windows runs. The runs so far: 8,858/8,907 ms, 33/40 ms and 10/11 ms.
- `scripts/desktop-e2e.mjs:50-89`: BUDGETS; workflow_start_ms 45,000, «unchanged until 1.2».
- `scripts/bank-sim/perf.mjs:19-52`: SERVER_BUDGETS against their recorded baselines:

  | Budget | Limit | Recorded baseline |
  |---|---|---|
  | TTFB | 300 ms | ≤ 22 ms |
  | DOMContentLoaded | 1 s | 121–179 ms |
  | API p95 | 1 s | 115–223 ms |
  | sign-in | 2.5 s | 0.49–0.59 s |
  | load-test p95 / p99 | 150 / 300 ms | 10–45 / 16–65 ms |
  | idle CPU | 30% | 1% |

- Journal wf_466384e2-dd9:
  - finding P-3: `scripts/desktop-e2e.mjs:844-860` rethrows without recording a failed check, and finish() writes the reports first;
  - finding P-5: the loose budgets.
- Runner CPUs differ between runs (PERFORMANCE_FA §19: EPYC 9V74 vs 7763).

**Proposal.**
- **Stall-watch evidence plan:**
  - put the stall watch's lines (count, longest hold, requests held) and the template timings into the desktop-e2e report and job summary;
  - collect at least 5 Windows runs of 1.1.1;
  - if a hold of 1 s or more recurs outside the splash, it is a product defect (PERF-10), never a reason to re-run.
- **Runner data:** record the runner's CPU model and the load-test yardstick in every report.
- **Re-based budgets:** a scheduled CI workflow (nightly or weekly) runs desktop-e2e and bank-sim on main and appends the numbers to a baseline file. Every budget becomes 2–3× the median of at least 5 Windows runs, normalised by the yardstick. Budgets only get tighter.
- **Fix P-3:** record a failed check before rethrowing.
- **Form timings:** add create and edit timings for incident, change, request item, KB article, CI, asset and workflow step form, per persona, with budgets in desktop-e2e and bank-sim.

**Done when.**
- At least 5 consecutive Windows runs of 1.1.1 or later pass desktop-e2e on the first attempt, with no stall of 1 s or more outside the splash.
- PERFORMANCE_E2E_FA §1-5 and §2-5 give every budget with its multi-run median and run ids, and no budget is looser than 3× its median.
- A forced scenario crash shows as failed in report.md and in the job summary.
- Both reports carry create and edit timings with budgets.

**Depends on.** PR #53 (1.1.1).

### QA-2 · Close the race leftovers since the organisation write lock was removed (D4)
P0 (QA-2a) · P1 (QA-2b) · M · server, web, windows · status: a open; b open

**Problem.** D4 removed the per-organisation write lock, so every check-then-write path can now race. Reviews and the D4 audit left:
- known races;
- an inverted lock order;
- a skipped cost-cap race;
- many fixes without a race test.

Part a holds the races that corrupt data or lock an installation out, which makes it P0:
- two concurrent disables or revokes can leave no active platform administrator;
- Windows-app pushes can create duplicate CMDB relationships;
- field_def is read without a lock while forms are saved or fields attached;
- the inverted lock order between a sync push and an asset status change deadlocks, answered as 503.

**Evidence.**
- F1-9: `src/server/modules/fields/combinations.ts:131` and `src/server/modules/fields/service.ts:214` read field_def without `for share`.
- F2-5: `src/server/modules/forms/hooks.ts:36` reads library fields with no lock (journal wf_37cdafce-7ad).
- IR-5: `src/server/routes/sync.ts:237` locks the pushed row (`for update`) before `src/server/modules/itam/bank.ts:641` locks the asset in derivePush, the reverse of a web status change (journal wf_2a78ecba-6ed, which cites the line as `:217` before later edits).
- A2-33 (the request_task part) and A2-40 were skipped (journal wf_434b5124-765). For A2-40, `src/server/modules/ai/skills/runtime.ts:224-231` counts daily limits before the model call at `:641-647`, and reserves nothing.
- A3-12 residual: `src/server/modules/cmdb/hooks.ts:503` gives ci_rel only a beforeWrite, which pushes skip, so Windows apps can create duplicate relationships.
- D4 open notes: HTTP CMDB imports answer 503 with no retry, and the known 40P01 pairs map to 503.
- `src/server/modules/platform/users.ts:37-38` counts active platform admins on `cfg.db`; the checks at `:56` and `:113` run before the transactions that start at `:57` and `:115`.
- Fixes with no race test:
  - mediums A3-20, -22, -23, -24, -26, -27, -28, -30, -31, -32 and -36;
  - lows A1-21..26 and A3-37..49 (journal wf_434b5124-765, open).

**Proposal.** Every fix gets a real-PostgreSQL race test (helpers hold/whileHeld in tests/races-pg).
- **QA-2a (P0, M, M1):** take the locks the reviews named:
  - a lock key for the last-admin checks, taken inside the transaction;
  - the relationship duplicate check on the push path;
  - field_def `for share` in attach and form save;
  - an asset pre-lock registered beside registerPushOrder.
- **QA-2b (P1, M, M1):**
  - a reservation row for each started skill run, under the skill's lock key (A2-40);
  - restructure the request-task roll-up, and add `retry: true` to imports;
  - race tests for the listed fixes that have none;
  - a nightly 30-minute soak with 50 concurrent writers on the server edition, reporting 40P01, 40001 and 503 counts.

**Done when.**
- QA-2a: each of its four fixes has a real-PostgreSQL race test that fails before the fix.
- QA-2b:
  - 20 concurrent skill runs never exceed daily_limit (real PostgreSQL);
  - every listed fix has a race test that fails before its fix;
  - the nightly soak shows no lost update and no 500, and deadlocks appear only as retried 503s under a set ceiling.

**Depends on.** —

### QA-3 · The web edition end to end in CI: a PostgreSQL job, real Vercel + Supabase, a post-deploy smoke test
P1 · L · web · status: open

**Problem.**
- The web edition never runs end to end in CI. The check job only builds it, and the crawl runs the Windows-flavour server on PGlite.
- The suites that test cloud migrations on a real PostgreSQL are skipped in CI, because CI never sets their variables.
- The 1.1 speed changes were never measured on the web, nor was a cold start from fra1.
- The owner's first web installation failed in production.

**Evidence.**
- `.github/workflows/itsm.yml:29-52`: check runs typecheck, check:schema and the build. `:102-128`: clickthrough runs on the desktop-mode server.
- CLICKTHROUGH.md:159-160: «Cloud mode (Next.js on PostgreSQL) was not crawled».
- Skipped suites:
  - `tests/cloud-postgres.test.ts:206`: `describe.skipIf(!TEST_DATABASE_URL)`;
  - `tests/migrate-steps.test.ts:93` and `tests/engine-ddl-additive.test.ts:105`: `it.skipIf(!ITSM_TEST_PG_URL)`;
  - CI sets only ITSM_PG_URL and ITSM_PG_BIN (itsm.yml:76, :89-93).
- PERFORMANCE_FA §14 and §14-6: perf-web.mjs api, ui and cold exist only as manual tools.
- Journal wf_466384e2-dd9, notDone: the web edition was not measured for these changes.
- PLAN.md 13:55Z Nov 14: sign-up, then a 500, after the schema was migrated mid-request.

**Proposal.**
- A `web-e2e` job:
  - postgres:17 behind PgBouncer in transaction mode, to match the Supabase pooler;
  - `next build`, then `next start` with DATABASE_URL;
  - the cold first request (migration steps and the 503 progress page), and the `scripts/migrate-db.mts` path;
  - sign-up and sign-in, `qa:crawl --quick` in cloud mode, the data-source screens, and a short load run.
- Set TEST_DATABASE_URL and ITSM_TEST_PG_URL in the test job, so the three skipped suites run.
- A scheduled job, within the Vercel quota:
  - deploys to a dedicated Vercel project with its own Supabase project;
  - migrates and seeds the small pack;
  - runs perf-web.mjs api, ui and cold, plus a quick crawl as admin, agent and requester;
  - checks budgets set from at least 5 runs.
- After each main deploy, a smoke job checks the production `/api/health`.

**Done when.**
- The three suites run in CI instead of being skipped.
- web-e2e is green and required by the release job (INFRA-1).
- The scheduled job is green at least weekly, and PERFORMANCE_E2E_FA gains a web section with its budgets.
- Each main push shows the post-deploy smoke result.
- A broken web start-up or migration turns CI red.

**Depends on.** Owner: dedicated Vercel and Supabase projects, the production URL and a protection-bypass token.

### QA-4 · Close the click-through coverage gaps
P1 · M · web, windows, server · status: open

**Problem.**
- On a fresh organisation, the crawler never reaches 16 parameterised pages.
- It never crawls the cloud mode, the server edition's own pages or the public token pages.
- CI runs only the quick crawl (267 of 2,241 checks), and that crawl gates nothing.

**Evidence.**
- CLICKTHROUGH.md «Not reached»:
  - notify/rules/builtin/:key
  - flows/:id/design
  - flows/runs/:runId
  - catalog-items/:id/builder
  - docs/d/:id/edit
  - kb/n/:number
  - kb/edit/:versionId
  - projects/:id/gantt
  - analytics/dashboards/:id/settings
  - itam/audits/:id/scan
  - esm/d/:key
  - hr/journeys/:id/tracker
  - customers/accounts/:id/360
  - slm/agreements/:id/360
  - slm/reviews/:id/pack
  - studio/t/:slot
- CLICKTHROUGH.md «Open»: the cloud mode; /p/kb, /p/survey and /p/ack; /admin/server and its /setup.
- itsm.yml:122 runs `--quick`; at `:131` and `:267`, windows and server need only check and test.
- Journal wf_7d0d5d88-cad: the data-source screens were crawled on PGlite only.
- `scripts/bank-sim/browser.mjs:291`: /admin/server is opened once, with no action.

**Proposal.**
- Seed one record per parameterised route in the crawler (reuse rd-q's seed after UX-1), and publish a KB link, a survey and an acknowledgement for the token pages.
- Run the cloud-mode crawl inside QA-3's job.
- In bank-sim, after setup, crawl /admin/server* and the server settings as the platform administrator.
- Run a nightly full crawl ×3 personas, with and without the demo pack.
- Make the quick crawl a required gate of the release job.

**Done when.**
- The «Not reached» and «Open» lists in CLICKTHROUGH.md are empty.
- The nightly full crawl stays green for two weeks.
- A broken page in any of the 16 routes fails CI.

**Depends on.** QA-3, INFRA-1; FEAT-12 (journey).

### QA-5 · End-to-end test of the installed Windows app linked to the installed server
P1 · M · windows, server · status: open

**Problem.** desktop-e2e runs the installed app standalone, and bank-sim drives the sync client headless. So these are never tested end to end:
- linking the installed app to the server through its own screens;
- working offline;
- two-way sync of 1.1 workflows with files (pending, then «در صف ارسال», then applied or refused).

**Evidence.**
- `scripts/desktop-e2e.mjs` has no link or sync step.
- BANK_SIM_FA §5: «برنامهٔ ویندوز با رابط گرافیکی … نصب و پیوند دادن خود برنامه با کلیک کاربر سنجیده نشده است».
- F7 notDone (journal wf_7d0d5d88-cad): the offline flow is tested only at the UI-model level, and there is no real-server multipart test.
- `tests/process-api-user.test.ts` has no multipart case, although `src/server/routes/process.ts:49-60` accepts multipart (at most 50 files; 413 over 101 MB).

**Proposal.** A bank-sim scenario on the Windows runner with the installed server:
1. Install this run's Kariz-Setup and link it through the UI to https://kariz.bank.local, with the bank CA.
2. Sign in as an agent and as a member, then cut the network.
3. Create an incident with an attachment, and submit a workflow step with a file.
4. Restore the network and assert that the server applied both (journal, attachments).
5. Produce one conflict and one refused submission, and check that the refused form is refilled.
6. Check the protocol-mismatch message with an older app.

Also add HTTP multipart tests for /process/start and /process/tasks/:id/submit.

**Done when.**
- The scenario passes in CI, with screenshots and sync logs in the artifact.
- Link time and the first full read have budgets.
- The multipart tests cover the file and size limits.

**Depends on.** —

### QA-6 · Pilot on real bank infrastructure: AD forest and Kerberos, hardening policies, EDR, real network
P1 · L · server, windows · status: open

**Problem.** The bank simulation cannot prove the parts that most often fail in banks:
- a real AD forest and Kerberos sign-in;
- hardening policies (AppLocker or WDAC, PowerShell restrictions, SCHANNEL);
- enterprise antivirus and EDR;
- proxies and TLS inspection;
- the real mail relay (authentication, rate limits, spam filtering);
- backup and restore times on real hardware and real data volumes.

Certificate rotation is never run on Windows in CI.

**Evidence.**
- BANK_SIM_FA §5 (lines 78–85):
  - the domain controller is a fake LDAPS server, with no referrals, Global Catalog, multiple DCs, lockout, password expiry or real Kerberos;
  - no GPO, AppLocker or WDAC; only the default Defender;
  - network latency near zero; the multi-year RTO never measured;
  - `:83` «رلهٔ واقعی ایمیل»: the simulated relay has no authentication, rate limit or spam filter.
- S1/S2 merge, open (journal wf_56381442-eb9): SSPI itself and --use-system-ca in a real Electron run were checked only by tests.
- `karizctl rotate-cert` appears only in install.ps1 and tests/packaging-review-fixes.test.ts.

**Proposal.**
- Run a pilot at a bank, or in a bank-like lab shared with PERF-2:
  - a domain-joined Windows Server 2022 with two DCs;
  - a GPO security baseline (AllSigned, AppLocker or WDAC), a commercial EDR and a TLS-inspecting proxy;
  - 3–5 years of synthetic data.
- Follow a written runbook built from AD_FA and BANK_INSTALL_FA §6.
- Measure LDAPS and Negotiate sign-in, install and upgrade, backup and restore (RTO and RPO), and the antivirus exclusions.
- Send notifications through the bank's own mail relay, with its authentication, rate limits and spam filtering.
- Automate what CI can in bank-sim: rotate-cert, and Kerberos sign-in against a Samba AD DC.
- Feed the findings back as fixes and doc changes.

**Done when.**
- A signed pilot report has every checklist item passed or fixed.
- The measured RTO and RPO are in BANK_INSTALL_FA.
- rotate-cert and Kerberos sign-in scenarios run in bank-sim.

**Depends on.** Owner: a pilot bank or lab; SEC-3 (signed binaries for AppLocker/WDAC rules).

### QA-7 · Workflow, forms and fields leftovers from the 1.1 reviews
P2 · L · web, windows, server · status: open

**Problem.** Under the token budget, only the high and medium findings of track F and the UI round were fixed. The verified lows and small gaps below remain on main.

**Evidence.** From journals wf_37cdafce-7ad and wf_7b3e41ba-241. Server paths are under `src/server/modules/`, except `routes/` (`src/server/routes/`) and `shared/` (`src/shared/`).

Forms:
- F2-3: `forms/preview.ts:28-33`, `:113`. StepOfForm has no `locked`, so preview and apply give different rights.
- F2-4: `forms/values.ts:74`, `:89`. «نمایش وقتی…» is judged on the apply clock, while the values come from the submission day.
- F2-6: `preview.ts:119` uses the designer's condEnv for every `as`.
- F2-7: `forms/list.ts:105`, `:310` count kinds after the ?kind= filter.

Workflow engine and API:
- F4a-6: `flows/executor.ts:680-701`. Withdrawn waits keep `waiting` step-log rows, so the case shows the withdrawn branch as active.
- F4a-7: `shared/process/validate.ts:198-205`. A process with one shared «رد» end cannot be published.
- F4b-9: `process/access/guards.ts:47-57` refuses an unchanged resend of an upload, so an upload whose answer was lost stays stuck.
- F4c-7: `routes/process.ts:127-138` asks for re-authentication before checking rights.
- F4c-8: `process/api/inbox.ts:250`. Retired processes vanish from «گردش‌کارهای من».
- F4c-9: `routes/process.ts:201`. Reassign requires `to`, so a step cannot be re-resolved against its rules.
- F4c-10: these notices are hard-coded direct notices, not editable rules:
  - reminder and overdue (`process/api/notices.ts:30`, `:72`; `timers/timer.ts:217`, `:253`, `:272`);
  - delegation-move (`timers/delegation.ts:106`);
  - refused push (`sync/apply.ts:96`);
  - stopped run (`engine/steps.ts:347`; `recovery/index.ts:78`).
- F4c-11: `api/inbox.ts:155-157`. The nav count builds the whole inbox.

Other gaps:
- estimateStep counts the demo pack's people (`positions/service.ts:212-236`), while the resolve preview filters them out (`:188`).
- process_draft rows are never cleared after a submit or start (`api/inbox.ts:403`, `api/cases.ts:256`). Only the browser clears them (`src/ui/modules/workflows/user/api.ts:527-541`).
- The assignee and starter pickers offer only built-in roles (`src/ui/modules/workflows/kit/AssigneePicker.tsx:16`, `:54`).
- No test covers the lists_changed notice, and F4b-11's rights-agreement test covers only a small graph.

UI:
- F5-7: `TableFields.tsx:145` and `SystemDesigner.tsx:413` offer «حذف از جدول» on customWrite, but deleting needs settings delete.
- F5-8: `FieldsPage.tsx:102-104` passes only isLoading, so failed reads look like empty lists.
- F5-10: `positions/model.ts:74` joins with " · " instead of SEP.

**Proposal.**
- Fix each finding as its review suggests, with a test that fails without the fix.
- Seed editable notification rules for the hard-coded notices, and bump NOTICES_VERSION.
- Make the nav count one count query.
- Clear a draft in the transaction that applies its start or step.
- Exclude the pack's people from estimates while a pack is loaded.
- Serve the organisation's own roles to designers through a read-only endpoint gated on process_design.

**Done when.**
- Every listed finding is closed with a test.
- The inbox count is one query, pinned by a perf-guard test.
- With a pack loaded, the estimate equals the resolve preview.
- No draft row remains after a submit (web or Windows).
- A custom role can be chosen as assignee or starter.
- Escalation notices can be edited in the notification rules.

**Depends on.** —

### QA-8 · Data-source leftovers: review lows and console polish
P2 · L · web, server · status: open

**Problem.** Verified lows remain in the connectors, the status pass, the ITAM feed and the data-source screens. They cause notice spam, tight retry loops, session leaks on vCenter, lost serial numbers, a large memory cost on feed preview, and misleading UI options. Smaller gaps remain too:
- item search works only by name and the tool's id;
- push connectors create assets up to a day late;
- asset managers get no notice when the feed creates assets;
- vCenter's host list gives no maintenance mode.

**Evidence.** From journals wf_5839f373-45b and wf_7b3e41ba-241.

Runs, status and the ITAM feed:
- DA1-9: `discovery/runner.ts:669` sends the mass-drop e-mail at every pass while a drop is held.
- DA1-10: service.ts reads the card's `held` from any latest run.
- DA1-11: jobs.ts lets retry-only passes delay listings.
- DA1-12: `discovery/kind.ts:113`'s web refusal points to «رلهٔ کاریز», which moved to 1.2.
- DA2-9: `status.ts:479`, `:489`, `:610` answer `again: 0`, a tight loop while the lease is held.
- DA7-3..7 (`discovery/itamfeed.ts`):
  - a 423 counts as a refusal;
  - no job is queued when the feed is switched on;
  - the lease is kept;
  - the closing warning is dropped;
  - «بی‌دارایی» returns whole records.

Connectors:
- DA3a-7: `connectors/vcenter.ts` (around :91) treats a 403 as an expired session.
- DA3a-8: `connectors/zabbix.ts:305` lets a placeholder serialno_a beat a real serialno_b.
- DA3a-9: `zabbix.ts:61-66` does not map an index.php address to api_jsonrpc.php.
- DA3a-10: the vCenter preview shows hosts only.
- DA3c-4: `connectors/feed.ts:212-218` caps the cache by count (CACHE_MAX 4), and test and preview parse the whole file inside the request. A 50 MB CSV costs about 3.5 s of CPU and 218 MB.
- DA3c-5: the feed has few availability words, and unknown values are dropped silently.

Data-source screens (DA4-5..10):
- two screens share the title «منبع داده تازه»;
- the console has no cards for file, URL and collector sources;
- the pager goes past the 5,000 rows the board serves;
- the key is not asked again when «روش ورود» changes;
- status minutes are offered for kinds with no status pass;
- «پوشهٔ ورودی سرور» is offered on the web.

Gaps:
- `src/shared/tables/discovery.ts:116`, `:118`: search only on external_id and name.
- push.ts never queues discovery.itam (grep).
- RELEASE_FA:81: vCenter host maintenance.

**Proposal.**
- Fix each finding as its review suggests, with mock-tool tests in tests/mocks/discovery.
- Search items by an indexed expression over data->ips and data->serial_number.
- Queue discovery.itam after a push batch.
- Bound the feed cache by total bytes.
- Send asset managers a daily notice of the assets made.
- Read host maintenance through the vSphere VI/JSON API on vCenter 8.0U1+, or fall back to event-management maintenance windows.

**Done when.**
- Each finding is closed with a test.
- Searching «10.20.101.1» or a serial finds the item.
- A push batch with new devices creates assets within one tick when the feed is on.
- Two 50 MB feeds never exceed the byte cap.
- Asset managers get one notice a day, with counts.
- A vCenter 8 host in maintenance shows «در نگهداری».

**Depends on.** FEAT-7 (the vendor field names).

### QA-9 · Test-suite runtime, UI interaction tests, clock and load dependence
P2 · M · web, windows, server · status: open

**Problem.**
- The whole suite (3,719 tests) takes about 2.3 h on the shared build machine. The 1.1 packages therefore skipped whole-suite runs, and regressions surfaced only in late reviews.
- The demo-purge proof alone takes 12–37 min.
- UI behaviour is tested only through pure helper functions, because vitest runs in node with no DOM.
- Several CI failures came from the clock or from machine load.

**Evidence.**
- Journal wf_37cdafce-7ad: «a whole-suite run needs about 2.3 h».
- PLAN.md 08:40 Nov 14 (no per-package whole-suite shards) and 02:30 Nov 15 (3,719 tests).
- Run 43696253020: the shards took 11.7–18.1 min against timeout-minutes 40 (itsm.yml:56).
- demo-purge took 2,206 s locally (journal wf_2a78ecba-6ed).
- `vitest.config.mts` sets the environment to "node", and package.json has no jsdom, happy-dom or Testing Library. fin-ui notes (journal wf_b73ae1aa-c4e).
- Failures root-caused one by one:
  - demo-purge residue, four times (including the hotfix 88ecfba);
  - the on-call rotation test failing by weekday and hour (d619a91);
  - sign-in races (38c6147, c50838f).

**Proposal.**
- Publish per-file timings from CI and balance the shards by duration.
- Move the demo-purge proofs into their own parallel job.
- Add a DOM layer (happy-dom and Testing Library) for dialogs, leave guards and forms that rely on pure helpers today; axe goes into the crawl through UX-8.
- Run nightly with a shifted clock and time zone (Saturday 06:58 Tehran, month ends, the Jalali year end), and repeat the demo-purge proof nightly under CPU load.

**Done when.**
- The whole suite finishes in under 60 minutes of CI wall-clock time, with no shard over 20 minutes.
- A per-file timing artifact is published.
- At least 30 DOM tests cover the workflows, fields and forms dialogs.
- The nightly clock and load jobs are green.

**Depends on.** —

### QA-10 · Time every route as admin, agent and requester, with budgets per page template
P1 · M · web, windows, server · status: open

**Problem.** The owner asked for the speed of every page and action, as admin and as user.
- The crawler opens all 1,417 registered routes as three personas but only checks for errors. It waits up to 15 s for a page to settle and records no time, so a page that takes 14 s passes.
- Timed budgets exist only for the 10–15 main pages per persona in desktop-e2e and bank-sim.
- QA-1 adds form timings and PERF-3 the record page; every other route stays unmeasured.

**Evidence.**
- `scripts/ui-crawl.mjs:61-62`: SPIN_MS = 15000, «a loader still on screen after this long is «endless»».
- `scripts/ui-crawl.mjs:433-440`: settle waits until no API call is open and no loader shows, up to SPIN_MS. The only time the crawler records is the whole run's (`:861`).
- `docs/qa/CLICKTHROUGH.md:171`: 1,417 registered routes and 2,241 checks.
- `docs/qa/PERFORMANCE_E2E_FA.md` §1-2 items 5 and 7, and §2-2 items 2 and 3: the timed page lists.

**Proposal.**
- The crawler records, per route and persona, the time to content (desktop-e2e's definition), the number of API calls and their p95.
- It also times the primary header action and the «… تازه» save.
- It runs on bank data in bank-sim (server edition, medium pack) and on the Windows runner.
- It publishes a sorted table, with budgets per page template (list, record, dashboard, designer, settings) set at 2–3× the multi-run median, as QA-1 does, and fails CI on a miss.

**Done when.**
- Every crawled route has a measured time per persona on bank data.
- The 20 slowest routes are listed with their API p95.
- A deliberately slowed route fails the job.
- PERFORMANCE_E2E_FA carries the per-template budgets.

**Depends on.** QA-1 (the baseline method); UX-13 (the deterministic crawl, after UX-1 rewrites the crawler).

### QA-11 · AI on the air-gapped Server Edition, end to end: a bank-sim scenario, offline model delivery and sizing
P1 · M · server · status: open

**Problem.** AI aligned with access is a headline of the product, but on the bank edition it never runs end to end.
- The server edition supports local models only, so the bank brings its own Ollama or vLLM server.
- The guides' model setup uses `ollama pull`, which needs the internet, and SERVER_FA has no offline model delivery.
- Neither bank-sim nor desktop-e2e uses the assistant, sourced answers, skills or agents.

So latency on CPU-only bank servers, the «فقط محلی» data policy and the access canaries through a real model are unproven.

**Evidence.**
- `docs/SERVER_FA.md:19`: the server edition's AI is «فقط محلی (Ollama، vLLM …)»; §10 (`:174-180`): build a model server in the bank network and allow-list it.
- `docs/BANK_INSTALL_FA.md:84`: an optional outbound rule to the model server.
- `docs/AI_FA.md:265-276`: the Ollama setup with `ollama pull`.
- grep of `scripts/bank-sim/*.mjs` and `scripts/desktop-e2e.mjs` finds no AI route; AI is tested only by the 35 `tests/ai-*.test.ts` files.

**Proposal.**
- A bank-sim scenario with an OpenAI-compatible model server on the LAN allow-list: a deterministic mock in CI, a small llama.cpp model in the lab.
- As admin, agent and requester: the assistant, «پاسخ با منبع», one skill and one agent proposal.
- Canary records that each persona must not see, the «هرگز» and «فقط محلی» policies, and latency budgets.
- In SERVER_FA: offline delivery of model files, and a sizing table for CPU-only and GPU servers.

**Done when.**
- The scenario passes in CI, and the canaries prove each persona gets only what it may read.
- Budgets for the first token and the full answer are recorded.
- SERVER_FA has the offline model steps and the sizing table.

**Depends on.** PERF-2 (the lab numbers, for the sizing table only).

## Security (SEC)

### SEC-1 · Every member can read the organisation's audit log and support sessions
P0 · S · web, windows (LAN and linked mode), server · status: open

**Problem.** GET /o/:org/audit returns up to 300 rows with each actor's full name and e-mail, and /support-sessions lists the support sessions. Both ask only for settings:view, which the membership roles «عضو» and «ناظر» hold. So every agent and requester can read who did what in the organisation; in the bank pack, everyone is «عضو». The «گزارش رویدادها» menu row also offers the page to them. The fix exists only on rd-base.

**Evidence.**
- Main:
  - `src/server/routes/org.ts:322-324`: `/audit`, `ctx.need("settings", "view")`, `select a.*, u.full_name, u.email … limit 300`;
  - `src/server/routes/org.ts:336-338`: `/support-sessions`, the same check;
  - `src/server/context.ts:417-422`: need() uses the membership role only;
  - `src/shared/permissions.ts:35-46`: member and viewer have settings "view";
  - `src/ui/modules/settings/index.tsx:33`: the menu row;
  - RELEASE_FA:68: the demo accounts are «همه عضو عادی».
- rd-base:
  - commit 7fbfe90 adds needPlatformGrant (`src/server/access/service.ts`) and uses it on both routes;
  - its test is in `tests/ui-shell-access.test.ts`.
- Fix round 3's API probe (journal wf_ae679a62-9a5): agent 403, requester 403, owner 200.
- The helpers the fix needs already exist on main: `src/server/access/subject.ts:315`, `:360` and `src/shared/access/model.ts:189`.

**Proposal.**
1. Cherry-pick the server half of 7fbfe90 onto main now: needPlatformGrant, the two route lines and the test.
2. Gate the «گزارش رویدادها» row with the same rule: a role that reads all of settings, or the audit area.
3. Add a «تازه‌ها» line and a RELEASE_FA note.
4. Leave the navgate rewrite to UX-1.

**Done when.**
- Agents and requesters with ITSM roles get 403 on /audit and /support-sessions.
- The owner, admins, an auditor role and legacy members (no ITSM roles) still get 200.
- The test passes on PGlite and on real PostgreSQL.
- crawl --quick ×3 personas shows 0 problems.
- The agent's settings sidebar no longer shows «گزارش رویدادها».

**Depends on.** —

### SEC-2 · Tenant regular expressions in catalogue questions and event rules can pin a worker (ReDoS)
P0 · S · web, windows, server · status: open

**Problem.**
- **Unguarded patterns.** Catalogue variable, request-definition and event-rule patterns are written by tenant users. They run on the server with only a syntax check, on every portal checkout and every incoming event.
- **The attack.** A pattern with nested quantifiers blocks the Node event loop of a worker or of the job runner when it meets a crafted value. Examples: `^(a|aa)+$`, `(\w+\s?)+$`, or even a bank form's `^(\d{4}-?)+$`. The crafted value can be a requester's answer, an inbound e-mail, or an alert message of up to 2,000 characters that a monitoring tool controls.
- **The impact.** On the server edition, that worker serves people.
- **The gap.** F1-1 (rated high) added a guard for library-field patterns, but it never reached these two older paths.

**Evidence.**
- `src/shared/request/form.ts:361-386`: compileRegex, then `re.test` in checkValue. checkAnswers is called by `src/server/modules/request/actions.ts:150`, `:244` and `lifecycle.ts:157`.
- Save-time syntax checks only: `src/server/modules/request/catalog-hooks.ts:87-92` and `definition.ts:191-197`.
- `src/shared/event/logic.ts:151-175`: matchPattern and patternProblem check syntax and length (≤ 300) only. They run for every event at `src/server/modules/event/pipeline.ts:149`.
- The guard already exists: `src/shared/forms/validators.ts:135` (patternWays), `:248` (patternProblem), `:258` (matchesPattern).
- Journal wf_37cdafce-7ad: «F1-1 follow-up (outside F1)», skipped.

**Proposal.**
- At save time, call patternProblem from `@shared/forms/validators` on both paths.
- At run time, use matchesPattern/usable with the value-length cap, plus a guarded exec variant that keeps event rules' named groups.
- A one-off upgrade scan disables stored unusable patterns with a Persian reason and notifies their owners.
- Parameterise the F1 regex tests over all call sites.

**Done when.**
- Saving `^(a|aa)+$`, `(\w+\s?)+$`, `^(\d{4}-?)+$` or a back-reference is refused with the validators' Persian message, in a catalogue variable, a request definition and an event rule.
- A stored unsafe pattern run on a crafted 2,000-character answer or alert completes in under 50 ms, on PGlite and on PostgreSQL.
- Safe patterns and named-group extraction are unchanged: the request and event suites pass.
- The new tests fail without the change.

**Depends on.** —

### SEC-3 · Code-sign the installers, the shipped binaries and the installer's PowerShell scripts
P0 · M · server, windows · status: open

**Problem.** Nothing Kariz ships is signed: not Kariz-Setup.exe, not Kariz-Server.msi, not the executables they install (karizctl included), and not the PowerShell scripts the MSI runs with -ExecutionPolicy Bypass.
- SmartScreen warns.
- The MSI refuses to install where Group Policy sets AllSigned, and the guide tells banks to relax the policy to RemoteSigned.
- AppLocker and WDAC publisher rules cannot be written.

**Evidence.**
- `packaging/server/wix/Package.wxs:43`: the launch condition refuses AllSigned. `:99-112`: powershell.exe -ExecutionPolicy Bypass for install, upgrade and uninstall.
- SERVER_FA:110: «MSI هنوز امضای دیجیتال ندارد … Run anyway».
- DESKTOP_FA:12: «فایل امضای تجاری ندارد».
- BANK_INSTALL_FA:26: AllSigned must become RemoteSigned for this server.
- BANK_SIM_FA §5: no GPO, AppLocker or WDAC.
- No signing in `desktop/electron-builder.yml`, `packaging/server/scripts/build-msi.ps1` or itsm.yml (grep).

**Proposal.**
- The owner obtains an OV or EV code-signing certificate, with the key in an HSM or a cloud signing service, or provides a bank's internal code-signing CA for bank-specific builds.
- In the release job (INFRA-1), sign with RFC 3161 timestamps:
  - the Electron executable and the NSIS installer and uninstaller, through electron-builder's Windows signing hook;
  - every executable and DLL the MSI installs that is not already vendor-signed, and the MSI itself after WiX;
  - each .ps1 the MSI runs (Set-AuthenticodeSignature).
- Remove the AllSigned refusal once the scripts are signed.
- Publish the signatures, the SHA-256 sums and the signer's thumbprint.
- Check Get-AuthenticodeSignature in the smoke tests, and run bank-sim under AllSigned with an AppLocker publisher rule.
- Remove the «Run anyway» and RemoteSigned steps from the guides.

**Done when.**
- Get-AuthenticodeSignature is Valid for the EXE, the MSI, every script the MSI runs, and karizctl.
- bank-sim passes with AllSigned set by machine policy and with an AppLocker publisher rule.
- The signing key never lands on the runner's disk.
- No guide asks anyone to bypass SmartScreen or relax the policy.

**Depends on.** Owner: the certificate and key custody; INFRA-1.

### SEC-4 · Independent penetration test and security assessment before bank production
P0 · L · server, web, windows · status: open

**Problem.** All security assurance so far comes from internal AI adversarial reviews and from bank-sim's configuration checks. No third-party penetration test or ASVS-style assessment exists, and a bank's security function requires one before production. Late reviews kept finding high-severity access holes right up to release.

**Evidence.**
- No pen-test or ASVS report in itsm/docs.
- bank-sim scenario 8 «وضعیت امنیتی» checks TLS, ports, ACLs and the diagnostics bundle (BANK_SIM_FA:47). BANK_SIM_FA §5 lists residual risks.
- Late high findings:
  - 8 high access holes in journal wf_c36c5624-40f;
  - FINAL-1 and FINAL-2 (high), found in the release workflow wf_7d0d5d88-cad;
  - SEC-1, found on main after the release.

**Proposal.** An external grey-box test against OWASP ASVS 4.0 L2 and the OWASP LLM Top 10.
- The server edition on Windows Server:
  - the installer, services and ACLs;
  - TLS, HSTS and CSP;
  - sign-in, AD/SSO, sessions and re-authentication;
  - multi-organisation isolation, and the access model across modules;
  - the sync API and device tokens;
  - /api/v1, webhooks and inbound endpoints;
  - uploads, antivirus and quarantine;
  - karizctl;
  - the assistant and agents against prompt injection and RAG leakage, with canary records.
- The web edition's tenant isolation, and the Windows app's local server.

Reserve a fix window and a re-test, and publish `docs/SECURITY_FA.md` for banks with the remediation status.

**Done when.**
- After re-test, the vendor's report has no open critical or high finding.
- Every medium finding is fixed or recorded as an accepted risk.
- SECURITY_FA.md is published and linked from BANK_INSTALL_FA.

**Depends on.** Owner: a vendor contract (start now). Run it after SEC-2, SEC-3, SEC-5a, SEC-6, SEC-7a, SEC-8 and QA-2a, so it tests the M1 build.

### SEC-5 · Dependency audit in CI, SBOMs, and the @hono/node-server advisory
P0 (SEC-5a) · P1 (SEC-5b) · S · web, windows, server · status: a open; b open

**Problem.** CI runs no dependency audit, CodeQL or Dependabot, and releases ship no SBOM, which bank procurement commonly asks for. npm audit reports a moderate advisory in a direct dependency of the HTTP server of the server edition and the Windows app. One of its two advisories bypasses path-based access control at a reverse proxy, and SERVER_FA documents IIS in front of the server edition, so the bump (part a) is P0.

**Evidence.**
- `npm audit --package-lock-only --omit=dev` (15 Nov 2026): @hono/node-server 2.1.5 (package.json:33 `^2.1.5`, package-lock 2.1.5; affected range 2.0.0–2.1.5, fixed in 2.1.6), with two advisories:
  - GHSA-jpvv-r467-5p4w: «Backslash in the request path is parsed as a path separator, bypassing path-based access control at a reverse proxy»;
  - GHSA-qv5m-9pm6-hqp3: «Unhandled ECONNRESET … during an asynchronous WebSocket upgrade crashes the process».
- It is used by `src/server-edition/worker.ts:11` (getRequestListener) and `src/desktop/server.ts`. SERVER_FA §9 (`:171`) puts IIS with Windows Authentication in front of the server on loopback, and §20 (`:317`) documents `trusted_proxies` for reverse proxies.
- `desktop/package-lock.json`: 6 moderate build-time advisories (electron-builder → app-builder-lib → minimatch).
- .github has no dependabot.yml and no CodeQL, and itsm.yml has no audit step.

**Proposal.**
- **SEC-5a (P0, S, M0):** bump @hono/node-server to 2.1.6 or later, update the lock, and add a test that a backslash-separated path is not routed as a different path.
- **SEC-5b (P1, S, M1):**
  - bump the electron-builder chain once a fixed minimatch ships;
  - add an audit step to the check job: fail on high and report moderate, with an allow-list whose entries each need a reason and an expiry date;
  - enable Dependabot security updates for itsm/ and itsm/desktop/;
  - generate CycloneDX SBOMs for the server bundle and the desktop app, and attach them to each release;
  - turn on secret scanning with push protection.

**Done when.**
- SEC-5a: npm audit reports no @hono/node-server advisory on main, and the path test fails on 2.1.5.
- SEC-5b:
  - a newly published high advisory fails CI;
  - each release has sbom-server.cdx.json and sbom-desktop.cdx.json;
  - Dependabot opens PRs for itsm/.

**Depends on.** SEC-5a: —. SEC-5b: INFRA-1 (SBOMs on releases).

### SEC-6 · Web edition deployment safety and an unauthenticated public-API route
P0 (web) · S · web, server · status: open

**Problem.** Four problems:
1. **Preview deployments migrate.** At runtime, the web edition runs migration steps on every deployment unless AUTO_MIGRATE=false, Vercel Preview included. Only the build step honours VERCEL_ENV=preview, yet SETUP_FA says a Preview never changes the database. A branch Preview that sees the production DATABASE_URL applies an unmerged branch's schema steps to production: a data risk, which makes SEC-6 P0 for the web edition. SETUP_FA's protection rests only on the owner scoping the variable by hand.
2. **No lock timeouts.** Steps run inside requests with no lock_timeout or statement_timeout, while their DDL takes ACCESS EXCLUSIVE locks.
3. **Manual parts skip the lock.** The SQL Editor parts do not take the migrations' advisory lock, so a manual run can interleave with the app's own steps.
4. **An open route.** POST /api/v1/batch/query is reachable without the API-key middleware. Every query in the batch crashes for lack of a context and logs an unhandled error.

**Evidence.**
- `src/server/cloud.ts:137-143`, `:202-205`: runSteps runs unless AUTO_MIGRATE=false, with no VERCEL_ENV check.
- `scripts/migrate-db.mts:36`: Preview is skipped at build time only.
- SETUP_FA:233 says the opposite; SETUP_FA:239 asks for a Production-only DATABASE_URL. PLAN.md 14:00Z Nov 11.
- `src/server/db/migrate.ts` sets neither lock_timeout nor statement_timeout.
- `supabase/manual/01-of-09.sql … 09-of-09.sql` contain no `pg_advisory_xact_lock(724100)`.
- The open route:
  - `src/server/routes/records.ts:140`: `/batch/query`;
  - `src/server/routes/integration.ts:194-196`: apiAuth only on /r/*, /meta/* and /attachments/*;
  - `src/server/routes/integration.ts:209`: `pub.route("/", recordRoutes)`;
  - `src/server/app.ts:124`: /v1 is mounted in every mode.
- Web review findings W2, W4, W6 and W7 (journal wf_bdc6089f-220).

**Proposal.**
- handleCloud treats VERCEL_ENV=preview without MIGRATE_ON_PREVIEW=true like AUTO_MIGRATE=false: it answers 503 «not current» and runs no step.
- Each step's transaction sets `lock_timeout = '5s'` and a statement_timeout below maxDuration, and maps SQLSTATE 55P03 and 57014 to busy, retried later.
- Every generated manual part starts with `select pg_advisory_xact_lock(724100);`.
- Mount /batch/query only under /o/:org, or refuse it when there is no context.
- Add a test for each, and correct SETUP_FA §2.

**Done when.**
- A request in the Preview environment never runs a step.
- A step blocked by a held lock reports busy within 5 s, and a later call retries it.
- tests/schema-manual asserts the advisory lock in every part.
- An unauthenticated POST /api/v1/batch/query answers 401 or 404 and logs no error.

**Depends on.** —

### SEC-7 · Multi-factor sign-in for local and privileged accounts
P0 (SEC-7a) · P1 (SEC-7b) · M · web, server, windows · status: a open; b open

**Problem.** Kariz has no second factor. These accounts sign in with a password alone:
- platform administrators and tenant administrators;
- breakglass and setup-administrator accounts;
- application accounts and web-edition accounts;
- any account a bank does not federate through AD.

Security incidents, access-request workflows and the system console are therefore protected by one factor. SERVER_FA's bank checklist relies on a strong password and a kept recovery code for the privileged and local accounts. A bank security function normally refuses production with single-factor privileged access, and the catalogue rates MFA P0, so part a (privileged and local accounts) is P0.

**Evidence.**
- FEATURES_FA:366: ACC-070 «احراز هویت چندعاملی و کلید عبور», P0.
- FEATURES_FA:292: the built list names AD, Kerberos, the session policy and breakglass, but no MFA.
- `grep -riE 'totp|webauthn|passkey|otpauth'` over src finds nothing.
- SERVER_FA §17: `:258` (the platform admin's account has «رمز قوی و کد بازیابیِ نگه‌داری‌شده») and `:260` (local sign-in only for «حساب‌های اضطراری», kept with «رمز قوی»).

**Proposal.**
- **SEC-7a (P0, M, M1):**
  - TOTP enrolment, with recovery codes;
  - required by policy for platform admins, tenant admins, the setup administrator and breakglass accounts;
  - asked at sign-in and at the existing «تأیید دوباره» re-authentication;
  - works offline on the server edition, and the Windows app signs in through the linked server;
  - AD and SSO sign-ins stay as they are.
- **SEC-7b (P1, M, M1):**
  - an organisation policy for who else must use MFA: roles with the admin persona, or everyone;
  - TOTP for the other application and web-edition accounts;
  - passkeys (WebAuthn).

**Done when.**
- SEC-7a:
  - when MFA is required, a privileged account cannot finish signing in without a valid TOTP;
  - recovery codes work once each;
  - re-authentication for publish, connector secrets and demo purge asks for the code;
  - lockout and throttling apply to codes;
  - breakglass needs MFA once it is enrolled, and bank-sim signs in a breakglass account with TOTP;
  - tests cover web, server and a Windows app linked to a server.
- SEC-7b: the organisation policy enforces MFA for the roles it names, and a passkey signs in on the web and the server edition.

**Depends on.** Owner: the default policy (open question 13).

### SEC-8 · Access-control leftovers in workflows, monitoring and member invitations
P0 · M · web, server, windows · status: open

**Problem.** Reviews verified several access gaps that 1.1's budget left open. Each was rated low on its own, but together they bypass the access model, the product's security guarantee, and SEC-4's penetration test waits for them. Together they:
- leak delegations and asset attributes;
- allow unauthorised attachments on cases;
- reveal whether a case exists;
- keep a 6-hour window for forged workflow history;
- bypass the plan's seat ceiling.

**Evidence.**
- **F3-5:** `src/server/modules/positions/service.ts:33-39`: canPreview also admits org-write holders. The preview runs as the system and returns delegatedFrom names, exposing delegation rows that only their two people may read (`src/shared/tables/approvals.ts:148-151`).
- **F4b-8:** `src/server/engine/sync.ts` never calls beforeSide (grep count 0); only the API does, through checkSide (`engine/hooks.ts:220-222`). A participant's Windows app can therefore push attachments onto a case, because CASE_FILES (`process/access/guards.ts:24`) is refused only in the API's beforeSide (`:62`, registered at `:161`). process_submission has no beforeSide at all.
- **F4b-10:** `src/server/routes/process.ts:207-209` → `recovery/index.ts:104-108`. managedCase answers 403 for an existing case the caller cannot read, and 404 for an absent one.
- **Upload window:** `src/server/modules/process/sync/upload.ts:26` sets UPLOAD_WINDOW_MS to 6 h, and the window never closes after a complete upload (journal wf_7d0d5d88-cad). For those 6 h, a stolen owner device token can upload finished workflow history.
- **DA2-10:** `src/server/modules/discovery/status.ts:780-799`. The board's CI side left-joins sm_assets with no asset read rule, and returns the asset's branch_id, category and device_status.
- **Seat ceiling:** `src/server/routes/org.ts:173-212` (POST /o/:org/members, used by `src/ui/modules/settings/Members.tsx:104`) checks no plan member ceiling. Import (`admin/members.ts:195-202`), SCIM (`integration/scim.ts:189-193`) and directory sign-in do (journal wf_434b5124-765, D4 fix A1).

**Proposal.**
- Remove the org-write branch from canPreview, or leave delegatedFrom out for callers who cannot read the delegation.
- In sync checkSide, call the table's beforeSide for pushed side rows. Add a process_submission beforeSide that accepts files only on a pending submission from its own submitter.
- Answer 404 unless the case is readable, before managedCase.
- Close the upload window after the adopting device's first complete push, and shorten its TTL.
- Add the asset read predicate to the board's CI-side join.
- Call needWithinLimit and limitAtCommit in POST /members.

**Done when.**
- Six regression tests, one per bullet, pass on PGlite and on real PostgreSQL.
- The FINAL-7 and FL-1 board and panel tests gain a case with an unreadable asset.
- After a completed upload, a further finished-case push from the owner is refused.

**Depends on.** —

### SEC-9 · AI assistant and agents: guardrail leftovers
P2 · M · web, server, windows · status: open

**Problem.**
1. **Skill tools bypass field groups.** An agent's skill tools run the skill as the AI principal and return its text, JSON and suggestions without the agent's own field-group and forbidden-field guardrails. An agent kept out of a field group can still receive it through a skill.
2. **Drafts ignore organisation requirements.** AI draft tools do not mark organisation-required fields (formRequired), so a draft fails only when someone applies it.
3. **Demo AI egress is undecided.** The owner's decision on AI provider calls for demo data is pending: loading the pack indexes it through the organisation's embedding connection.

**Evidence.**
- `src/server/modules/ai/agents/tools.ts:40-70`: skillTool returns r.text, r.json and suggestions; the per-field guardrails from `:75` on cover the generated tools only. Journal wf_2f505f27-57e: «The free-text output of a skill is not filtered by field group».
- formRequired is never referenced under src/server/modules/ai (F1 part 2 notDone, journal wf_37cdafce-7ad).
- `src/server/db/scope.ts:82-88`: the AI providers are the one deliberate exception.
- PLAN.md, R-a entry: «OPEN DECISION for owner … default keep».

**Proposal.**
- Run agent skill tools with a context narrowed to the agent's field groups, or filter their output: fields, suggestions, and free text drawn from forbidden groups.
- Mark formRequired fields as REQUIRED in the draft tool schemas for the persona they bind.
- Record the owner's answer on demo AI egress in DEMO_FA and AI_FA. If it stays allowed, index demo work with the local embedder.

The monitoring-status tool is FEAT-13.

**Done when.**
- Canary tests: an agent without the group «financial» gets no financial value through any skill tool.
- A draft missing a formRequired field is refused when it is drafted.
- The decision is recorded in DEMO_FA and AI_FA.

**Depends on.** The owner's decision on demo AI egress.

### SEC-10 · Key management and data at rest: rotate the application secret, encrypt backups, protect the Windows app's token
P2 · M · server, windows, web · status: open

**Problem.**
- **One secret, no rotation.** One application secret signs sessions and derives every encryption key: stored SMTP, AD, AI and webhook secrets, engine secret fields, and the ITAM custody HMAC. It cannot be rotated, and sealed values carry no key id, so a rotation would orphan them all.
- **Plain backups.** Server backups (pg_dump plus attachments) are written unencrypted.
- **Plain token.** The Windows app keeps its server bearer token in plain config.json.

**Evidence.**
- `src/server-edition/config.ts:77-78`, `:448-452`: the secret is generated at install and «signs sessions and encrypts stored secrets».
- Keys derived from it: `src/server/modules/ai/crypto.ts:25`, `src/server/modules/itam/bank.ts:91`, `src/server/modules/integrations/crypto.ts:9-16`, `src/server/engine/values.ts:533`.
- `src/server-edition/ctl.ts:603-713`: karizctl has rotate-cert, but nothing for the secret or the database passwords.
- `src/server-edition/backup.ts`: pg_dump -Fc; the manifest only fingerprints the key (`:39-45`). BANK_INSTALL_FA:191 keeps the key out of the backup, but the backup itself is plain.
- `src/desktop/config.ts:15`, `:32`, `:48`, `:80`: cloud.token is stored in config.json, with no Electron safeStorage or DPAPI.

**Proposal.**
- A keyring: a key-id prefix on sealed values, and `karizctl rotate-secret`, which adds a new key, re-seals in batches and keeps the old key until the custody chains (and SEC-12's audit chains) are re-signed.
- `karizctl rotate-db-password`.
- Optional backup encryption (AES-256-GCM, with the key from kariz-admin.json or a DPAPI-protected file), verified with pg_restore --list after decrypting.
- The Windows app's token in Electron safeStorage (DPAPI), with existing tokens migrated.
- Document BitLocker for laptops that hold the local database.

**Done when.**
- After rotate-secret, every stored secret decrypts, the custody chains verify, and sessions signed with the old key are re-issued.
- An encrypted backup restores on a new server with the key, and fails clearly without it.
- After upgrade, config.json no longer contains the token.

**Depends on.** —

### SEC-11 · Step-up confirmation for approvals and workflow decisions
P2 · M · web, windows, server · status: open

**Problem.** Approving a change, a purchase over its limit or an access request records only the session's user. A bulk «تأیید» of up to 200 approvals needs no re-authentication and leaves no signed record of the decision. Workflow publish already asks for re-authentication, but deciding a step does not. Banks' change and access controls usually require step-up confirmation for high-risk approvals.

**Evidence.**
- `src/server/routes/sla.ts:82-91`: POST /approvals/decide takes 1–200 ids, and /:id/decide calls decide/decideMany with no needRecentAuth.
- No reauth or needRecentAuth in src/server/modules/sla (grep). needRecentAuth is used by `src/server/modules/process/publish/service.ts` and `src/server/routes/process.ts`, among others.
- FEATURES_FA:1112: CHG-033 (P0) is half-built, «بدون امضای الکترونیک و احراز دومرحله‌ای».
- Design F §10: an electronic signature is not in version 1.
- No chained log exists to hold the digest: `src/server/db/migrations/0001_core.ts:133-146` (sm_audit) and `0002_platform.ts:32-43` (sm_security_events) have no hash or prev_hash. Only asset custody (`src/server/modules/itam/bank.ts:94-150`) and DevOps gate evidence (`src/server/modules/devops/hooks.ts:51`) are chained.

**Proposal.**
- A per-approval-rule and per-workflow-step option «تأیید با احراز دوباره».
- Decisions under it require recent authentication, with MFA once SEC-7a lands.
- Bulk decide skips those approvals and reports them.
- Store a decision digest (who, what, record version, time) in SEC-12's chained audit log.

**Done when.**
- With the option on, deciding without recent authentication gets 401 reauth_required, and it succeeds after re-authenticating.
- Bulk decide leaves those approvals pending, with a Persian reason.
- The audit log shows the decision's digest, and SEC-12's `karizctl audit verify` checks it.
- Approvals without the option behave as they do today.
- A Windows app linked to a server refuses these decisions offline with «این کار به اتصال نیاز دارد».

**Depends on.** SEC-7a (MFA at «تأیید دوباره»); SEC-12 (the chained log).

### SEC-12 · Tamper-evident audit and security logs, forwarded to the bank's SIEM
P1 · M · server, web, windows · status: open

**Problem.** Banks forward privileged-action and sign-in logs to a SIEM and need them tamper-evident.
- Kariz keeps the audit log and the security-events log as plain rows that anyone with database access can change unseen.
- Nothing sends them out.
- The owner's catalogue rates the chained privileged-action log P0 (ACC-095) and SIEM integration P1 (INT-025, planned).
- SEC-11's decision digest needs a chained log.

**Evidence.**
- `src/server/db/migrations/0001_core.ts:133-146`: sm_audit has no hash and no prev_hash. `0002_platform.ts:32-43`: sm_security_events, likewise. No later migration adds them.
- Chaining exists only for asset custody (`src/server/modules/itam/bank.ts:88-150`: an HMAC with a key derived from the server secret) and DevOps gate evidence (`src/server/modules/devops/hooks.ts:51`).
- No syslog, CEF or SIEM sender in src; grep finds SIEM only as an incident-source label (`src/shared/tables/security.ts:54`).
- `docs/FEATURES_FA.md:391` (ACC-095, P0) and `:248` (INT-025, P1, in the planned list at `:219`).

**Proposal.**
- Chain both logs per organisation: prev_hash plus an HMAC with a server key, as asset custody does, checked by `karizctl audit verify`. The key follows SEC-10's keyring.
- Forward new rows as syslog over TLS (RFC 5424/5425) or CEF to a collector on the air-gap allow-list, with a disk spool and retry.
- A retention setting, and an export of the chain for auditors.

**Done when.**
- Editing or deleting a row breaks `karizctl audit verify` (test).
- A bank-sim syslog collector receives sign-in, admin-change and support-session events within 60 s, also across a restart.
- SEC-11's digest uses the chain.

**Depends on.** —

## Docs (DOC)

### DOC-1 · Put the 1.2 planning inputs in git
P1 · S · web, windows, server · status: open

**Problem.** The designs this roadmap builds on exist only in the session scratchpad, which a reboot or cleanup can clear:
- design F (forms and workflows, 136 KB);
- design A (asset integrations and connectors, 158 KB);
- the stage-B unit list.

Only the C2 plan is committed, and only on rd-base. FEAT-3 to FEAT-18, UX-2 and UX-6 cite sections of designs A and F.

**Evidence.**
- `git ls-tree -r` of origin/main, rd-base and itsm-dev finds no F-FORMS-WORKFLOWS, A-ASSET-INTEGRATIONS or RD-B file. rd-base holds only `itsm/docs/qa/redesign/C2-{INVENTORY,SPEC,PACKAGES,QA}.md`.
- The scratchpad holds `design/F-FORMS-WORKFLOWS.md`, `design/A-ASSET-INTEGRATIONS.md`, `briefs/RD-B.md` and `rd-b/b1.args.json`, `rd-b/b2.args.json`.
- PLAN.md 08:40 Nov 14: the golden data is to be deleted if the disk falls under 3 GB. 5.3 GB were free on 15 Nov.

**Proposal.**
- Commit designs F and A unchanged, as `itsm/docs/design/F-FORMS-WORKFLOWS.md` and `itsm/docs/design/A-ASSET-INTEGRATIONS.md`, marked as design records.
- Commit the stage-B unit list beside the C2 plan. Write it from rd-b/*.args.json as a plain list: briefs/RD-B.md is an agent brief full of session paths and is not committed.
- Link both from this roadmap.

The golden images and the vision findings are UX-2.

**Done when.** The two designs and the unit list are in git on main, and every "design A §" and "design F §" reference in this document resolves to a committed file.

**Depends on.** — (the merge that carries it needs INFRA-1 or a version bump).

### DOC-2 · English engineering specs for the 1.1 workflows and data sources
P2 · M · web, windows, server · status: open

**Problem.** Developers have no English engineering reference for the two largest 1.1 subsystems. docs/spec/services/ holds only flows.md, notify.md and sla.md. The English access spec does not cover:
- the new areas «طراحی فرم و گردش‌کار» and «پرونده‌های گردش‌کار»;
- organisational roles;
- the auditor's read.

ENGINE.md §11 is already written: it covers the field library, formHidden, _states and process forms.

**Evidence.**
- `git ls-tree origin/main itsm/docs/spec/services/` lists flows.md, notify.md and sla.md.
- `grep -c process_design docs/spec/ACCESS.md` gives 0.
- `docs/spec/ENGINE.md:511`: §11 «Tenant customisation».
- Design F §12 F8 and design A §24 DA5.
- Journals wf_7d0d5d88-cad (the spec pages were not written) and wf_37cdafce-7ad (ACCESS.md's role matrix was not updated).

**Proposal.**
- Write spec/services/process.md: tables, applySubmission, authority, sync, access, the upload rule, jobs, budgets and invariants.
- Write spec/services/discovery.md: kinds, budgets, staging, IRE edits, status, the stale ladder, the push API and safety.
- Add the two areas and the roles to ACCESS.md's role matrix.
- Link all of them from SERVICES.md and ENGINE.md.

**Done when.**
- The three documents exist and are linked.
- Every exported route and job kind of the process and discovery modules is named in them.
- A test, like discovery-docs, fails when a new route or job kind is missing from the spec.

**Depends on.** —

### DOC-3 · Docs that drifted from the code and the measurements
P2 · S · web, windows, server · status: open

**Problem.** Several docs describe behaviour that has changed or was never measured:
- the write lock and sync cursor from before D4;
- SETUP_FA's table and step counts;
- the queue's settings and capacity;
- the yield's headline effect;
- kariz.json keys missing from SERVER_FA §20;
- no per-version upgrade notes.

**Evidence.**
- Stale since D4 (D4 final review lows, journal wf_434b5124-765):
  - ENGINE.md:344 («writes still hold the write lock»);
  - spec/services/notify.md:172;
  - ARCHITECTURE_FA.md:51 and :64.
- SETUP_FA:20 and :119 say «۵۳۰ جدول … ۸۴ مرحله», while supabase/schema.sql has 550 tables.
- PERFORMANCE_FA.md:180 (§7) says `tick(cfg, { budgetMs: 4000, concurrency: 4 })` every second, but the code uses a 20 s budget (`src/server-edition/worker.ts:280`) on a 5 s interval (`config.ts:151`).
- PERFORMANCE_FA §9 promises "hundreds of jobs per second", while §19 measured 72–100 jobs/s on CI and 7.9–18 locally.
- PERFORMANCE_FA:17 and §19 give the 3,622 → 1,627 ms headline, while runs without the yield measured 1,744, 1,692 and 1,318 ms (journal wf_466384e2-dd9 P-6).
- SERVER_FA §20 lacks `scheduler.interval_s` (`config.ts:76`, `:151`, `:293`); journal wf_46d4c423-b8a: «Minor doc mismatch, left as is».
- SERVER_FA §14 has no version-specific upgrade notes; only RELEASE_FA:75 carries the protocol note.

**Proposal.**
- Correct the stale passages.
- Generate SETUP_FA's counts from the schema fingerprint, with a docs test.
- Restate the queue settings and the measured jobs/s, and add capacity per size once Q-3 measures it.
- Restate the yield's effect against the run-to-run spread.
- Add a test that every kariz.json key in `src/server-edition/config.ts` appears in SERVER_FA §20.
- Add a per-version «what this upgrade changes» block to SERVER_FA §14.

**Done when.**
- A search for the write lock finds only historical sections.
- The counts test and the kariz.json keys test pass.
- Every queue number cites the run it came from.

**Depends on.** Q-3 (for capacity per size).

### DOC-4 · Refresh the feature catalogue's build statuses to 1.1
P1 · M · web, windows, server · status: open

**Problem.** FEATURES_FA.md is the owner's list of what the product does against mature ITSM tools. Its status lines were written at each module's first version and are out of date:
- they miss all of 1.1: fields, forms, workflows, organisational roles, data sources and bank ITAM;
- some say built features are planned, for example portal announcements and offboarding;
- whole tables have no status at all.

Planning the final version from it is unreliable, and FEAT-19 plans the remaining catalogue work from this recount, so it comes first (P1).

**Evidence.**
- The file was last changed on 11 Nov, and its status blocks say «نسخهٔ نخست ماژول» (for example FEATURES_FA.md:157, 432, 725).
- A read-only parse of the status blocks against the tables (15 Nov): the ACC (66 P0 rows) and PLT (57) tables have no status line at all, and 20 AI and 11 SLM P0 rows are in none of their module's lists (FEAT-19 has the full counts).
- INC-043 (FEATURES_FA.md:482) says portal display is pending, but `src/server/modules/portal/home.ts:270-271` serves active announcements.
- REQ-032 (:763) says offboarding comes later, but `src/server/modules/esm/seed.ts:169` seeds «خروج کارمند».
- EVT-002 (:593) says there is no PRTG, but DA2 added the prtg event format.
- Journal wf_51d4be9c-ad8: the feature counts and statuses were not recounted.

**Proposal.**
- For each module, re-derive built, half-built, planned and moved-to-1.2 from the code and the module docs.
- Add the 1.1 capabilities.
- Recount the summary table.
- Reference this roadmap's IDs for the 1.2 items.

**Done when.**
- Every status block says «۱٫۱», and every P0 row has a status line.
- 20 sampled IDs match the code, including INC-043, REQ-032, EVT-002, PLT-004, PLT-005 and CMDB-026.
- The summary counts add up.

**Depends on.** —

## Suggested plan for 1.2

Every milestone ends with full CI green on the first attempt. All P0 items close by the end of M2: they sit in M0 and M1, except PERF-1 and PERF-2 in M2.

### M0 — patch line 1.1.x (now)

**Items:**
- In flight: PR #53 (1.1.1), with QA-1's root-cause fix (settleFiles, the stall watch) and the version bump.
- Add to the patch line: INFRA-1 (with the release read-back), SEC-1, SEC-2, SEC-6, SEC-5a (the hono bump), Q-7's export download guard, UX-9, UX-11, DOC-1 and this roadmap.
  - If PR #53 is still open when they are ready, they join it.
  - Otherwise they form 1.1.2, which bumps the version again unless INFRA-1 is already in.

**Closing check:**
- All 11 ITSM CI jobs are green on main on the first attempt.
- The release is created only by the gated release job (INFRA-1), with SHA256SUMS and a verify step that lists both digests.
- `itsm-v1.1.0`'s digests are unchanged.
- The SEC-1, SEC-2, SEC-5a, SEC-6, UX-9 and export-guard tests fail without their fixes.
- npm audit reports no @hono/node-server advisory.
- crawl --quick ×3 personas shows 0 problems.
- One adversarial review (access and regex lenses) has run.

### M1 — bank readiness and security

**Items:**
- Correctness, first: Q-1, then QA-2a, Q-7 (the chain keeper) and FEAT-2.
- Security: SEC-8, SEC-7a, SEC-3, SEC-5b, SEC-7b, SEC-9, SEC-10, SEC-12, then SEC-11.
- Infrastructure: INFRA-3a, INFRA-2, INFRA-3b, INFRA-4, INFRA-5, INFRA-11.
- Quality: QA-2b, QA-5.
- Docs: DOC-4, so the FEAT-19 packages can be planned while M2 and M3 run.
- Then SEC-4, the penetration test, on the M1 build.
- Booked with the owner in M1, run as they become available: QA-6 (the pilot) and PERF-2 (the lab).

**Closing check:**
- The real-PostgreSQL tests of Q-1 (reclaim under backlog, poison jobs, fencing, bounded handlers), Q-7 (failed chains queued again within 2 minutes) and FEAT-2 (no false deactivation) pass.
- Every QA-2a race test fails before its fix and passes after; QA-2b's race tests and the nightly soak are green.
- SEC-8's six regression tests pass on PGlite and real PostgreSQL.
- bank-sim is green with ExecutionPolicy AllSigned and an AppLocker publisher rule.
- The PITR drill (scenario 11) restores to 5 minutes or less before the failure.
- A forced backup failure writes one Event Log entry, and later its clear; a full backup folder raises the error.
- The external-database CI variant passes bank-sim scenarios 3–12, and an upgrade on large data stays within the documented window.
- SEC-7a's MFA tests pass on all three editions, and bank-sim signs in a breakglass account with TOTP.
- `karizctl audit verify` catches an edited row, and the bank-sim syslog collector receives the events (SEC-12).
- In bank-sim, an app one protocol behind keeps syncing and updates itself from the server (INFRA-11).
- FEATURES_FA's statuses are recounted to 1.1 (DOC-4).
- The pen-test report has no open critical or high finding after re-test.

### M2 — performance and queue

It overlaps the tail of M1.

**Items:**
- Queue: Q-2, Q-3, Q-4, Q-5, Q-6, Q-8, Q-9, Q-10.
- Performance: PERF-1, PERF-3, PERF-4, PERF-6, PERF-7, PERF-8, PERF-10.
- Quality: QA-1 (the budgets), QA-3, QA-10, QA-11.
- Infrastructure: INFRA-6 phase 1, INFRA-7, INFRA-12.
- At the end: PERF-2, the published lab run, and QA-11's sizing table from it.

**Closing check:**
- The real-PostgreSQL queue tests pass: lanes, wake-ups and two job processes, with M1's lease and recurring-job tests still green.
- Every crawled route has a measured time per persona on bank data, within its page template's budget (QA-10).
- The AI scenario passes in bank-sim with its canaries and latency budgets (QA-11).
- bank-sim scenario 7 passes:
  - the purge takes 230 s or less;
  - SLA and notification jobs are not delayed by the demo load;
  - the oldest due job's age, read from the scraped metrics, stays within its budget.
- desktop-e2e `workflow_start_ms` is 3 s or less.
- Every budget is re-based from at least 5 Windows runs, none looser than 3× its median.
- web-e2e and the scheduled Vercel + Supabase job are green.
- PERF-1 holds on the full-scale seed (similar p95 300 ms or less).
- The PERF-2 report is published with measured sizing rows.

### M3 — design packages

It starts when UX-1 lands and runs beside M1 and M2, on UI files.

**Items:** in order, UX-2 part A, UX-1, UX-8, UX-2 part B, UX-13, UX-3, UX-7, UX-12, UX-4, UX-6 (with FEAT-1 on the merged kit), UX-5, UX-14.

**Closing check:**
- C2-PACKAGES §1.5 holds per package:
  - zero blocking lint hits;
  - a crawl per persona and rendering with no problems;
  - axe zero serious or critical;
  - a vision review with no open S1 or S2.
- UX-8's gates are required in CI.
- The desktop-e2e and bank-sim budgets are unchanged.

### M4 — connectors and features

The connectors are gated on the owner's answers.

**Items:**
- Connectors: FEAT-7, then FEAT-3, FEAT-4, FEAT-5 and FEAT-6; FEAT-10 when the owner wants web organisations with on-prem tools.
- Features: FEAT-20, FEAT-8, FEAT-9, FEAT-12, FEAT-13, FEAT-11, FEAT-14, FEAT-15, FEAT-16, FEAT-21.
- The catalogue: FEAT-19's packages, from DOC-4's recount, each after the UX-4 or UX-5 package of its module (they share its UI files).
- Leftovers: QA-7, QA-8.
- If time allows: FEAT-17, FEAT-18. Otherwise the owner moves them on.

**Closing check:**
- Each connector passes its mock tests and its real-instance fixtures.
- The discovery bank-sim scenario passes on the Windows runner.
- Each feature passes its acceptance tests.
- The catalogue recount shows no P0 «برنامه‌ریزی‌شده», and every P0 «نیمه‌کاره» is built or deferred by the owner with a reason (FEAT-19).
- demo-purge proves zero trace on PGlite and real PostgreSQL.
- The full crawl ×3 personas shows 0 problems.

### M5 — docs, final QA and release 1.2.0

**Items:**
- Docs: DOC-2, DOC-3 (DOC-4 moved to M1, ahead of FEAT-19).
- Final QA: UX-10, QA-4, QA-9.
- Infrastructure: INFRA-8; INFRA-6 phase 2, INFRA-9 and INFRA-10 per the owner's scope.
- PERF-5 and PERF-9.

**Closing check:**
- The docs tests pass: kariz.json keys in SERVER_FA §20, spec coverage, SETUP_FA counts.
- UX-10's three-edition visual gate passes.
- CLICKTHROUGH's «Not reached» and «Open» lists are empty.
- One adversarial review of the release candidate has run.
- 1.2.0 is published through the gated job with signatures, SHA256SUMS and SBOMs.
- RELEASE_FA, «تازه‌ها» and FEATURES_FA are updated.

## Owner decisions in force

1. **The redesign moved to 1.2** (the owner's message at 08:40 UTC on 14 Nov; PLAN.md «OWNER DECISION»).
   - rd-base, rd-p0 and rd-q are kept as branches for 1.2.
   - The golden data and the qa-shots are kept for now, and deleted if the disk falls under 3 GB.
2. **Connectors** (same decision).
   - Kept in 1.1: rest, push, feed (CSV/JSON), zabbix, prtg, vcenter and demo.
   - Moved to 1.2: glpi, mecm, ad_computers, ksc, endpoint_central, Windows authentication, sql_view, the software/SAM feed and the relay.
3. **1.1's economy** (same decision: "fastest path, fewest tokens").
   - No per-package whole-suite shards; the whole suite runs at the PR merge and in CI.
   - One reviewer per package, and no verifier.
   - Integration with one lens.
4. **Working rules:**
   - one push every two hours at most (Vercel Hobby allows 100 deployments a day);
   - "flake" is never a root cause;
   - never skip or loosen a test or a budget.
5. **Defaults that stand** from the owner questions of 11 Nov (PLAN.md, 16:45Z; asked as non-blocking):
   - the names «نقش سازمانی» and «جریان‌های خودکار»;
   - a device that goes missing becomes a task after 45 days;
   - connectors are in every plan;
   - the SNMP library comes later;
   - the relay comes in the second wave.
6. **Demo data and AI:** AI provider calls stay open for demo data by design. That is the default ("keep") until the owner answers (PLAN.md, R-a entry).
7. **Releases:**
   - an official release is made by the owner merging into main;
   - PRs merge with merge commits (the repository's convention);
   - other branches publish previews only.

## Open questions for the owner

1. **Patch line:** should the M0 P0s (SEC-1, SEC-2, SEC-5a, SEC-6 and Q-7's export guard) ship in 1.1.1 together with PR #53, or as 1.1.2?
2. **Release policy (INFRA-1):** may we turn on GitHub immutable releases and make a version bump the only way to publish an official release? Docs-only merges would then publish nothing.
3. **Code signing (SEC-3):** OV or EV certificate, and what key custody (HSM or a cloud signing service)? Or should each bank's internal code-signing CA sign its builds?
4. **Penetration test (SEC-4):** which vendor and what dates, for a scope of ASVS L2 plus the LLM Top 10?
5. **Bank lab and pilot (PERF-2, QA-6):**
   - hardware or large Windows runners for both published profiles;
   - a pilot bank, or a bank-like lab with two DCs, a GPO baseline, an EDR and a TLS-inspecting proxy.
6. **Web edition target (INFRA-7, INFRA-12, Q-9, QA-3):** is it for demos and small teams on Hobby + Free, or for customers' production?
   - If production: can you pay for Vercel Pro + Supabase Pro, which SETUP_FA says needs a non-Iranian card? Or should the production profile run on an Iranian VPS or the customer's own host, with a self-managed PostgreSQL?
   - For CI we need dedicated Vercel and Supabase projects and a protection-bypass token.
7. **High availability (INFRA-5, INFRA-6):** are the two-server layout and a standby required in 1.2? Are two app nodes (phase 2) needed at all?
8. **Connectors (FEAT-3 to FEAT-5, FEAT-7, FEAT-17):**
   - which tools do the target banks run, and in what order (design A §21 Q1)?
   - is the ATM switch database SQL Server or Oracle?
   - do you approve an SNMP library (§21 Q4)?
   - can we get access to Zabbix 6/7, PRTG 24.x and vCenter 7/8 test instances?
9. **RAG ranking (PERF-1):** may «رخدادهای مشابه» rank a bounded candidate set, or precomputed neighbours, judged on a labelled set of bank incidents?
10. **Demo pack (FEAT-12, SEC-9):**
    - should a real member's case of a demo workflow leave with the purge?
    - should AI provider calls stay open for demo data, or should demo data be indexed only with the local embedder?
11. **Process for 1.2:** keep 1.1's economy (no per-package whole-suite shards, one reviewer, no verifier)? Or restore the full review chain for security-sensitive and correctness packages (SEC-7a, SEC-8, QA-2a, Q-1)?
12. **Scope:** must all redesign packages (UX-4 to UX-6) land in 1.2, or may wave 2 (UX-5), FEAT-17 and FEAT-18 move to a later version if the schedule needs it?
13. **MFA default (SEC-7):** SEC-7a requires MFA for platform admins, tenant admins, the setup administrator and breakglass accounts. Should SEC-7b's organisation policy also require it for roles with the admin persona, or for everyone?
14. **Linux (INFRA-10):** is a Linux host for the server edition wanted at all?
15. **Catalogue scope (FEAT-19):** which half-built or planned P0 capabilities may move past 1.2, and for what reason? Which P1s do you want in 1.2? INT-042 (migration from OTRS/Znuny, GLPI and others) is proposed first.

## Appendix — where the researchers' IDs went

The five research passes (journal wf_c9703374-224) used their own IDs. This table maps them to this document.

| Pass | Their ID | This document |
|---|---|---|
| Queue | Q-1 … Q-10 | Q-1 … Q-10 (same) |
| | Q-11 | DOC-3 |
| Performance and infrastructure | PERF-01 … PERF-09 | PERF-1 … PERF-9 |
| | PERF-10 | Q-6 |
| | QUEUE-01 | Q-2, Q-3; lease renewal in Q-1, the lag metric in Q-6 |
| | QUEUE-02 | Q-5 |
| | INFRA-01 | SEC-3 |
| | INFRA-02 | INFRA-2 |
| | INFRA-03 | INFRA-3 |
| | INFRA-04 | INFRA-4 |
| | INFRA-05 | INFRA-1 |
| | INFRA-06 | QA-1; the headline in DOC-3 |
| | INFRA-07 | INFRA-5 |
| | INFRA-08 | INFRA-6 |
| | INFRA-09 | INFRA-9 |
| | INFRA-10 | INFRA-10 |
| | WEB-01 | QA-3 |
| | WEB-02 | Q-9 (queue); INFRA-7 (backups, production profile) |
| Design | DES-01 | SEC-1 |
| | DES-02 | UX-1 |
| | DES-03 | UX-3 |
| | DES-04 | UX-2 |
| | DES-05 | UX-4 |
| | DES-06 | UX-5 |
| | DES-07 | UX-6; the primary transition in FEAT-1 |
| | DES-08 | UX-7 |
| | DES-09 | UX-8 |
| | DES-10 | UX-9 |
| | DES-11 | UX-10 |
| | DES-12 | UX-11 |
| | DES-13 | UX-12 |
| | DES-14 | UX-13; the journey in FEAT-12 |
| | DES-15 | UX-14 |
| | DES-16 | DOC-2 |
| Features | FEAT-01 | SEC-2 |
| | FEAT-02 | FEAT-1 |
| | FEAT-03 | FEAT-3 |
| | FEAT-04 | FEAT-4 |
| | FEAT-05 | FEAT-5 |
| | FEAT-06 | FEAT-10 |
| | FEAT-07 | FEAT-2 (paged sync), FEAT-6 (SAM feed) |
| | FEAT-08 | FEAT-7 |
| | FEAT-09 | FEAT-8 |
| | FEAT-10 | FEAT-11 |
| | FEAT-11 | FEAT-9 |
| | FEAT-12 | SEC-7 |
| | FEAT-13 | SEC-11 |
| | FEAT-14 | FEAT-12 |
| | FEAT-15 | FEAT-13 |
| | FEAT-16 | FEAT-14; the limits race in QA-2 |
| | FEAT-17 | SEC-8 (upload window, pushed side rows); QA-7 (drafts, estimates, roles, notices) |
| | FEAT-18 | UX-7 |
| | FEAT-19 | DOC-2 |
| | FEAT-20 | DOC-4 |
| | FEAT-21 | FEAT-15 |
| | FEAT-22 | FEAT-17 |
| | FEAT-23 | FEAT-16 |
| | FEAT-24 | QA-8 |
| | FEAT-25 | FEAT-18 |
| Quality and security | QS-1 | INFRA-1 |
| | QS-2 | SEC-2 |
| | QS-3 | SEC-3 |
| | QS-4 | SEC-4 |
| | QS-5 | SEC-5 |
| | QS-6 | SEC-6 |
| | QS-7 | QA-1 |
| | QS-8 | QA-2 |
| | QS-9 | QA-3 |
| | QS-10 | QA-4 |
| | QS-11 | QA-5 |
| | QS-12 | QA-6 |
| | QS-13 | SEC-8 |
| | QS-14 | SEC-9; the monitoring tool in FEAT-13 |
| | QS-15 | SEC-10 |
| | QS-16 | QA-7 |
| | QS-17 | QA-8; the real instances in FEAT-7 |
| | QS-18 | FEAT-1 |
| | QS-19 | QA-9 |
| | QS-20 | DOC-2, DOC-3 |
| | QS-21 | INFRA-8 |
| New here | — | DOC-1 (planning inputs into git); PERF-10 (PGlite off the local server's thread); PERF-9 widened with first-start I/O. Sources: PR #53 and PLAN.md 10:50 UTC. |
| Critic review (same workflow) | corrections | Raised to P0: Q-1, Q-7, FEAT-2, SEC-6 (web), SEC-8. Split into a P0 and a P1 part: QA-2 (2a, 2b), SEC-5 (5a, 5b), SEC-7 (7a, 7b), INFRA-3 (3a, 3b). DOC-4 raised to P1. Corrected: INFRA-1 (release read-back), INFRA-7 (a profile without foreign payment), UX-12 (all 20 «ه‌ی» lines), SEC-11 (depends on SEC-12), UX-6 (the minimap), UX-7 (19), QA-6 (the mail relay), the itsm-int note. |
| | new items | FEAT-19 (catalogue P0s), FEAT-20 (holiday years), FEAT-21 (full exports), INFRA-11 (Windows fleet rollout), INFRA-12 (web attachments), QA-10 (every route timed), QA-11 (AI on the server edition), SEC-12 (chained logs and SIEM). |
