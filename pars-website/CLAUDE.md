@AGENTS.md

# Pars website — notes for Claude

Standalone Next.js 16 app in a sub-folder of the Task Flow repository (deployed as its own Vercel project with Root Directory `pars-website`). Read `README.md`, `docs/SETUP_FA.md` and `docs/BRAND_BOOK_FA.md` before larger changes.

- **Languages:** Persian (RTL) is primary at `/`, English at `/en` — two root layouts in route groups `(fa)` and `(en)`. All copy lives in `src/content/fa.ts` / `en.ts` (same shape). Keep English technical terms in English; Persian digits via `num()`; logical Tailwind utilities (`ms-`, `pe-`, `start-`, `end-`).
- **Brand:** tokens in `src/app/globals.css` (`@theme static`); logo paths in `src/components/brand/logo-data.ts` (vectorised from the official PNG — never edit or mirror the logo). No `letter-spacing` on Persian; animate Persian by word/line, never by letter. Never start the LCP heading at opacity 0.
- **CSS layers:** base element rules live in `@layer base`; custom classes that must lose to utilities go in `@layer components` (unlayered CSS beats Tailwind utilities).
- **Data:** server-only service-role client `db()` (`src/lib/db.ts`); tables `pars_*` with RLS on and no policies. Schema changes = a new idempotent file in `supabase/migrations/`.
- **AI:** `src/lib/ai/providers.ts` (raw fetch + SSE for Gemini, Anthropic, OpenAI-compatible) and `runtime.ts` (model fallback, system prompt). The assistant answers only from the knowledge base; markers `[[action:demos|ticket|contact]]` and `[[unknown]]` are parsed by `src/lib/markers.ts`.
- **Admin:** every Server Action in `src/app/actions/admin.ts` goes through `guard()` (session check). Public actions in `support.ts` validate input and rate-limit with `allow()`.
- **Performance:** keep public pages static; heavy/decorative code is lazy (chat panel, animated mark); the hero shader must stay adaptive. Check with `npm run build` and Lighthouse.
- Commands: `npm run typecheck` · `npm test` · `npm run build` (must pass with no env vars).
