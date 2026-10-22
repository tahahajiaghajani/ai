# Pars Project Management — website

Bilingual (Persian RTL primary, English) website of **Pars Project Management** (مدیریت پروژه پارس) with an AI-first hero, a hidden admin panel, smart ticketing and a demo catalogue.

> «جایی که مدیریت و هوش به هم می‌رسند» · *Where management meets intelligence.*

- **Setup (Persian):** [`docs/SETUP_FA.md`](docs/SETUP_FA.md)
- **Brand book & strategy (Persian):** [`docs/BRAND_BOOK_FA.md`](docs/BRAND_BOOK_FA.md)
- **Research:** [`docs/research/`](docs/research/) — market, branding & marketing, design & motion

## Features

- **AI-first hero** — a large "Ask Pars" composer opens a full-screen, streaming chat (like ChatGPT/Claude). Answers are grounded only in the admin-managed knowledge base (BM25 retrieval for Persian when it grows large), with action buttons (demos / ticket / contact), 👍/👎 feedback and logging for review.
- **Providers** — Google Gemini (free AI Studio key, automatic model fallback on quota), Anthropic Claude, any OpenAI-compatible API; optional custom base URL (relay). Keys are AES-256-GCM encrypted in the database.
- **Smart ticketing** — AI answer suggestions before submitting (deflection), AI triage (category, priority, sentiment, summary, draft reply), tracking codes (`PP-XXXXXX`), magic links, customer replies, resolve/close + rating, SLA deadlines, Telegram/Bale notifications, optional e-mail (Resend).
- **Hidden admin** (`/admin`, password + signed cookie) — dashboard & health checks, tickets, chat logs → "add to knowledge", knowledge editor with playground and JSON import/export, AI settings with connection test, unlimited demo links, CEO/contact/stats content.
- **Visual identity** — the official logo vectorised 1:1 (`public/brand`), a WebGL shader of the logo's ribbons meeting at one point (adaptive: still frame on software GL / reduced motion), scroll-driven logo assembly, CEO portrait reveal, bento services, CSS-only motion elsewhere.
- **Performance** — static pages (ISR), self-hosted fonts (only the Persian subset preloaded), lazy chat/mark chunks, `content-visibility`, compositor-only animations. Lighthouse (no GPU, simulated slow 4G): mobile 89–94, desktop 99; accessibility/best-practices/SEO 100.
- **SEO/GEO** — hreflang, sitemap, robots, Organization JSON-LD, OG image, `llms.txt` generated from the knowledge base.

## Stack

Next.js 16 (App Router, two root layouts: `(fa)` at `/`, `(en)` at `/en`), React 19, Tailwind CSS v4, Supabase (service-role, server only), Vitest.

```
src/app/(fa)/(site)        Persian pages          src/lib/ai/          provider adapters, prompts, fallback
src/app/(en)/en/(site)     English pages          src/lib/retrieval.ts  Persian-aware BM25 (pure)
src/app/(fa)/admin         hidden admin panel     src/lib/tickets.ts    ticket service + AI triage
src/app/api/chat           streaming chat API     src/content/          site copy (fa / en)
src/app/actions            Server Actions         supabase/migrations/  schema (pars_* tables)
```

## Commands

```bash
npm install
npm run dev         # http://localhost:3000
npm run typecheck
npm test
npm run build       # works without any environment variables
```

Environment variables: see [`.env.example`](.env.example).
