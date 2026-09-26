@AGENTS.md

# TaskFlow AI — project memory for Claude

This repo is the **TaskFlow AI** app: a Persian (RTL) multi-agent task automation & orchestration web app deployed on **Vercel (Hobby)** with **Supabase (Free)**. Requesters submit tasks; the admin approves them; a configurable workflow of Gemini agents does the pre-work; a workflow with Claude Code steps (GitHub Actions) finishes the work; everything is monitored live.

Read `docs/ARCHITECTURE_FA.md` (architecture) and `docs/INSTALL_FA.md` (setup) before larger changes.

## Stack
- Next.js 16 App Router (`src/proxy.ts` instead of middleware, async `params`/`searchParams`, `after()`), React 19, TypeScript strict.
- Tailwind CSS v4 (tokens in `src/app/globals.css` — use `bg-surface`, `text-muted`, `border-line`, `bg-primary-soft`, `glass`, stage colors `var(--stage-*)`).
- Supabase: `@supabase/ssr` (user session), service-role client `db()` in `src/lib/supabase/admin.ts` for server writes.
- AI: `@google/genai` (Gemini) wrapped in `src/lib/ai/gemini.ts`; LangChain core `Embeddings`/`VectorStore` for RAG.
- Workflows: `src/lib/workflow/` — agents + DAG workflows per stage (`prework`, `main`) stored in `app_settings` (`agents`, `workflows`), built-ins in `registry.ts`, visual builder at `/agents`.
- GitHub: `@octokit/rest` (Git Data API commits, workflow dispatch, secrets).

## Conventions
- **All UI text is Persian and RTL.** Use logical Tailwind utilities (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). Latin/code snippets get `className="ltr"` or `dir="ltr"`. Dates: `formatJalali()` from `src/lib/jalali.ts`; numbers: `faNum()`.
- Mutations go through **Server Actions** in `src/app/actions/*` that call `assertAdmin()`/`assertActive()` first and return `ActionResult` via `act()`. Never export helpers without auth checks from `"use server"` files.
- Task status transitions live in `src/lib/tasks/service.ts`; stage/status metadata in `src/lib/status.ts`.
- Background work = rows in `jobs`, processed by `src/lib/queue/tick.ts` handlers. Handlers must finish a step within the worker budget (~50s): throw `DeadlineError` to continue next tick, `RateLimitError` to pause the provider, return `{type:"continue"|"wait"|"done"|"fail"}`.
- The workflow engine (`src/lib/workflow/engine.ts`) advances **one step per invocation**; its state lives in `job_data.graph` (not in realtime rows). Ready Gemini nodes run in parallel (max 3); a Claude node dispatches GitHub Actions and `completeClaudeNode` hands the job back to the queue. Graph logic (`schedule`, `validateWorkflow`) is pure and shared with the UI (`types.ts`) — keep it free of server imports.
- Mutating Server Actions that change the current page use `mutate()` (server-side `refresh()`); don't also call `router.refresh()` after them. Non-critical writes (activity log, notifications) go through `background()` (`after()`).
- Supabase query builders are lazy — always `await` (or `.then()`) them.
- Database changes: add a **new** file `supabase/migrations/<timestamp>_<name>.sql` that is idempotent (`if not exists`, `create or replace`, `drop policy if exists`). Never edit an existing migration. Add RLS for new tables (reads only; writes via service role).
- Realtime: tables in the `supabase_realtime` publication are `tasks, task_events, jobs, provider_state, notifications, upgrades`. Keep heavy data out of realtime tables (use `job_data`).
- Secrets only in env vars (`src/lib/env.ts`) or GitHub Secrets. Never commit keys.

## Commands
- `npm run typecheck` · `npm run build` · `npm test` (vitest, `tests/`)
- The build must pass **without any env vars** (env is read lazily at runtime).

## Runner
- `workspace-template/` is copied into the `ai-workspace` repo by Settings → «راه‌اندازی مخزن کاری». `workspace-template/.github/scripts/taskflow.mjs` (Node built-ins only) is also used by `.github/workflows/self-upgrade.yml` in this repo.
