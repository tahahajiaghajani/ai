@AGENTS.md

# Portfolio — notes for Claude

Standalone Next.js 16 app in the `portfolio/` folder of this repository (its own Vercel project, Root Directory `portfolio`). Persian (RTL) at `/`, English at `/en`: two root layouts in route groups `(fa)` and `(en)`; page bodies are shared components that take `lang`. Read `README.md` and `docs/SETUP_FA.md` first.

- **Content** lives in `src/content/` with `{ fa, en }` pairs (`L` type). Case studies are one file each in `src/content/projects/`, registered in `index.ts`. Be honest about authorship: work built with Claude Code says so; simulated or planned results are labelled; client confidentiality notes stay. Never publish bank hostnames, staff names, internal URLs, private repos or other people's data.
- **Design:** black and white only — tokens in `src/app/globals.css` (`bg`, `fg`, `fg-2`, `muted`, `faint`, `line`, `bg-2`; `.tone-invert` for inverted bands; `.mono-media` for pictures that turn colour on hover). Never raw colours in components. Fonts: Vazirmatn (fa), Inter Tight (latin), Instrument Serif italic accents, JetBrains Mono labels. No letter-spacing on Persian; animate Persian by line or word, never by letter.
- **Mark:** `src/components/brand/mark-paths.ts` (Hamzad, one stroked path on a 512 grid). Icons in `public/` are rendered from it.
- **Motion:** declarative attributes handled by `src/components/fx/motion.tsx` (`data-fade`, `data-split`, `data-parallax`, `data-scrub-words`); everything respects reduced motion. Custom CSS classes go in `@layer components` so utilities win.
- **AI:** `src/lib/ai/` (Gemini REST + SSE, model chain), `src/lib/knowledge.ts` builds the assistant's knowledge from the content (plus `portfolio_knowledge` rows), `src/lib/retrieval.ts` (Persian BM25). Markers `[[work:slug]]`, `[[action:ticket]]`, `[[action:contact]]`, `[[unknown]]`.
- **Data:** server-only service-role client (`src/lib/db.ts`); tables `portfolio_*` with RLS on and no policies. Schema changes = a new idempotent file in `supabase/migrations/`.
- Commands: `npm run typecheck` · `npm test` · `npm run build` (must pass with no env vars).
