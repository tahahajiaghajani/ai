# Design & motion research — award-level B2B/AI sites (2025–2026)

> Collected 2026-10-22, mostly through search results (secondary sources); verify live sites before copying a pattern.

## Trends and fit for Pars
| Trend | Example | Fit |
|---|---|---|
| Prompt-first hero (big input + chips) | Lovable, v0, Replit, Perplexity, Voiceflow. Docket tested "ask-first" and kept it a real marketing site ([Docket](https://www.docket.io/blog/designing-docket-frameless)) | **Hybrid**: brand headline + live Persian RAG assistant as the hero, sales CTA beside it |
| Bento grids | Stripe Jan-2026 redesign; [SaaSFrame](https://www.saasframe.io/patterns/bento-grid) | Yes — services/suite |
| WebGL shader gradients | Stripe's legacy wave; Weavy and Microsoft AI (Awwwards SOTD) | **Strongest fit** — the ribbon logo as one light shader, and as a *system* (dividers, loaders) |
| Grain over gradients | Lovable | Yes, subtle — prevents navy→magenta banding |
| Aurora / "Linear effect" | now saturated ([LogRocket](https://blog.logrocket.com/ux-design/linear-design)) | Sparingly |
| Dark luxury, high contrast | Palantir | Yes — deep navy, never pure black, ≥ 4.5:1 text |
| Editorial display type | Harvey, Perplexity, Anthropic | English pages only |
| Kinetic type | Cohere rebrand | Yes, by word/line only |
| Glass 2.0 | `backdrop-filter` is the costliest common property | Small static panels only |
| Immersive 3D | Lando Norris (SOTY 2025) | Low for bank buyers — borrow scroll-storytelling for "how an agent works" |
| Real product UI over stock | Stripe 2026, Linear | Yes — show real Persian dashboards |

## Performance rules adopted
- Scroll-driven animations: Chrome 115+, Safari 26+, Firefox behind a flag → wrap in `@supports (animation-timeline: view())` + reduced-motion guard, static fallback.
- WebGL: raw full-screen quad (no three.js ≈150 kB), DPR ≤ 1.5, pause off-screen / hidden tab, start after hydration, CSS gradient fallback.
- **Never start the LCP heading at `opacity: 0`** (Chrome ignores opacity-0 paints for LCP) ([DebugBear](https://www.debugbear.com/blog/opacity-animation-poor-lcp)).
- INP ≤ 200 ms; split long tasks; `content-visibility: auto` + `contain-intrinsic-size` below the fold ([web.dev](https://web.dev/articles/content-visibility)).
- Fonts self-hosted (next/font), Arabic subset preloaded on fa pages, Latin on en pages.
- Reduced motion (WCAG 2.3.3) plus a site-level motion toggle.

## Persian / RTL rules
- Never split Persian into letters (breaks cursive joining); split by word (`Intl.Segmenter`) or line.
- No `letter-spacing` on Persian text.
- Mirror directional motion and progress; not clocks/circles. `translateX` is physical — mirror it for RTL on purpose.
- Digits: `Intl.NumberFormat('fa-IR')` (arabext digits), including animated counters.
- Body line-height ≈ 1.8–2.0, tighter for display sizes.
