# Taha Aghajani — portfolio

Bilingual (Persian RTL at `/`, English at `/en`) portfolio with case studies, an AI assistant grounded in the site's own content, and a smart request desk with AI triage and tracking codes.

- **Stack:** Next.js 16 (App Router, two root layouts), React 19, TypeScript strict, Tailwind CSS v4, GSAP + Lenis, raw WebGL for the hero portrait, Gemini REST over SSE (free model chain). **No database:** requests are issues, and the panel's settings and extra knowledge are files, in one private GitHub repository reached with a fine-grained token.
- **Design:** black and white only. The mark is **Hamzad** (همزاد): one stroke that reads as a Latin *t* and a Persian «ط».
- **Content:** `src/content/` — profile, expertise, journey, organisations and one file per case study in `src/content/projects/`.
- **Setup:** `docs/SETUP_FA.md` (Persian) — a private data repository and a fine-grained token on GitHub, a Vercel project with Root Directory `portfolio` and four env vars (`.env.example`), then everything else in the panel's **Connections** page (`/admin/connections`). The build needs no env vars.

```bash
npm ci
npm run dev
npm run typecheck && npm test && npm run build
```
