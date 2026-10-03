@AGENTS.md

# TaskFlow AI — project memory for Claude

This repo is the **TaskFlow AI** app: a Persian (RTL) multi-user task app with AI agents, deployed once on **Vercel (Hobby, Fluid compute)** with **Supabase (Free)** and shared by everyone. Anyone gives tasks to anyone (assignee field). In **simple mode** users only give/track tasks and update status by hand; in **full mode** each user connects their **own** AI keys (Anthropic, Google, OpenAI-compatible) and **own** GitHub workspace repo, and pre-work / main work run as configurable agent workflows. The **owner** (`OWNER_EMAIL`) manages the shared system, users and app upgrades.

Read `docs/ARCHITECTURE_FA.md` (architecture), `docs/INSTALL_FA.md` (owner setup) and `docs/SETUP_USER_FA.md` (users) before larger changes.

## Stack
- Next.js 16 App Router (`src/proxy.ts` instead of middleware, async `params`/`searchParams`, `after()`), React 19, TypeScript strict.
- Tailwind CSS v4 (tokens in `src/app/globals.css` — use `bg-surface`, `text-muted`, `border-line`, `bg-primary-soft`, `glass`, stage colors `var(--stage-*)`).
- Supabase: `@supabase/ssr` (user session), service-role client `db()` in `src/lib/supabase/admin.ts` for server writes.
- AI: provider adapters in `src/lib/ai/llm/` (`google.ts` via `@google/genai`, `anthropic.ts` via `@anthropic-ai/sdk`, `openai.ts` raw fetch+SSE for every OpenAI-compatible service), `generate.ts` (single calls, model fallback, error classes), `agent.ts` (resumable tool loop). Presets in `providers.ts` (client-safe).
- Users' connections: `src/lib/connections.ts` (secrets AES-256-GCM via `src/lib/crypto.ts`), per-user settings `src/lib/settings.ts` (`getUserConfig`), what a user can use: `src/lib/capabilities.ts`.
- Workflows: `src/lib/workflow/` — per-user agents (`llm`/`router`/`coder`) + DAG workflows per stage (`prework`, `main`) in `user_settings`, built-ins in `registry.ts`, visual builder at `/agents`.
- Projects: `src/lib/projects/` — files live whole in the user's repo under `projects/<slug>/`, app notes in `projects/<slug>/.taskflow/` (PROJECT.md, KNOWLEDGE.md, INDEX.md, graph/, tasks/); file map in `project_files`.
- GitHub: `@octokit/rest` per user (`userRepo(userId)`), the owner's app repo only for self-upgrade (`appRepo()`).

## Conventions
- **All UI text is Persian and RTL.** Use logical Tailwind utilities (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). Latin/code snippets get `className="ltr"` or `dir="ltr"`. Dates: `formatJalali()` from `src/lib/jalali.ts`; numbers: `faNum()`.
- Mutations go through **Server Actions** in `src/app/actions/*` that call `assertActive()` / `assertFull()` / `assertOwner()` first and return `ActionResult` via `act()`. Never export helpers without auth checks from `"use server"` files. Owner-only actions live in `actions/owner.ts`.
- Pages: `(app)` group = full mode (`requireFull()`), `/portal` = simple mode (`requireUser()`), owner pages call `requireOwner()`. Every query is scoped to the user (`assignee_id`/`owner_id`/`user_id`) unless the owner explicitly asks for `?scope=all`.
- Only the user's **prompt and the files of that send** go to the models — never the task title/description.
- Task status transitions live in `src/lib/tasks/service.ts`; stage/status metadata in `src/lib/status.ts`.
- Background work = rows in `jobs` (`owner_id`, `connection_id`, `lane` llm/external/system), claimed fairly per lane and per owner by `claim_job` and processed by `src/lib/queue/tick.ts` handlers. Handlers must finish a step within the worker budget (~240s): throw `DeadlineError` to continue next tick, `RateLimitError` to pause only that connection/model, `FatalError` for clear user errors; return `{type:"continue"|"wait"|"done"|"fail"}`.
- The workflow engine (`src/lib/workflow/engine.ts`) advances **one step per invocation**; its state lives in `job_data.graph` (not in realtime rows). Ready model nodes run in parallel (max 3); a `coder` node runs the in-app agent or dispatches Claude Code to the user's GitHub Actions, and `completeExternalNode` hands the job back to the queue. Graph logic (`schedule`, `validateWorkflow`) is pure and shared with the UI (`types.ts`) — keep it free of server imports.
- Project files are never chunked: whole files in GitHub, one KNOWLEDGE.md per project, new files only when needed.
- Mutating Server Actions that change the current page use `mutate()` (server-side `refresh()`); don't also call `router.refresh()` after them. Non-critical writes (activity log, notifications) go through `background()` (`after()`).
- Supabase query builders are lazy — always `await` (or `.then()`) them.
- Database changes: add a **new** file `supabase/migrations/<timestamp>_<name>.sql` that is idempotent (`if not exists`, `create or replace`, `drop policy if exists`). Never edit an existing migration. Add RLS for new tables (reads only; writes via service role).
- Realtime: tables in the `supabase_realtime` publication are `tasks, task_events, jobs, notifications, upgrades, connection_state`. Keep heavy data out of realtime tables (use `job_data`).
- Secrets only in env vars (`src/lib/env.ts`), encrypted in `user_connections`, or GitHub Secrets. Never commit keys and never put the owner's personal data in the repo.

## Commands
- `npm run typecheck` · `npm run build` · `npm test` (vitest, `tests/`; live provider tests: `LIVE=1 GEMINI_API_KEY=… npx vitest run tests/live`)
- `npm run template` after editing `workspace-template/` (the build checks the bundle is current).
- The build must pass **without any env vars** (env is read lazily at runtime).

## Runner
- `workspace-template/` is bundled into `src/lib/github/template.generated.ts` and copied into each user's workspace repo by Settings → GitHub (bump `.github/taskflow-version` and `TEMPLATE_VERSION` together). `workspace-template/.github/scripts/taskflow.mjs` (Node built-ins only) is also used by `.github/workflows/self-upgrade.yml` in this repo. Runners authenticate with a per-user token (`runnerTokenFor(userId)`).
