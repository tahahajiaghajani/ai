# CELIN / سلین — website

The bilingual website of the jewellery brand **CELIN** (Persian, RTL, at `/`; English at `/en`). A standalone Next.js 16 app in a sub-folder of this repository, deployed as its own Vercel project (Root Directory `celin-website`) with Supabase for data, accounts and pictures.

- **Everyone sees everything except price and stock.** Members request **Pro**; the admin approves and a 12-digit code is issued (inbox / SMS / e-mail / share buttons). The code unlocks prices and stock (served only by `/api/pro/prices` after a session check — public pages are static and price-free) and ordering.
- **Orders** without online payment; the store moves them through «در انتظار تایید فروشگاه» → «در حال جمع آوری و بسته بندی» → «آماده‌ی ارسال» → «ارسال شد» (or cancels, which restocks). Members follow them in their account (dashboard, orders with totals, cart, Pro, messages, wishlist, profile).
- **Admin** (`/admin`): dashboard, orders (status, shipping, pro-forma print), Pro requests and codes, members (create by hand, issue codes), products (photos, specs, options, price, stock), categories and collections, **site images** (every design picture is a slot with its texts; optional loop videos), settings (contact, announcement, ordering, Pro, SMS.ir / Kavenegar, Telegram / Bale notifications, e-mail, SEO) and a connections health page with copy-ready SQL.
- **Design:** immersive, architectural — Noto Naskh type, layered mesh colours (espresso, cocoa, paraiba teal, champagne, copper metal), the round arch as signature frame, smooth scroll, unveiling arches, live glints on the stones, WebGL silk light, pinned arcade reel, arch aperture. See `docs/DESIGN_SYSTEM.md`.

## Docs

- `docs/SETUP_FA.md` — step-by-step setup (Supabase SQL, Vercel, admin, Pro, SMS, domain, Iran access) — **start here**
- `docs/BRAND_BOOK_FA.md` — the brand book (story, voice, logo, colour, type, the arch, photography, naming, packaging, risks)
- `docs/DESIGN_SYSTEM.md` — tokens, type, components and effects for developers
- `CLAUDE.md` — conventions for AI-assisted changes

## Structure

| Path | What |
|---|---|
| `src/app/(fa)`, `src/app/(en)/en` | the two root layouts; route files are thin wrappers |
| `src/components/pages/*` | page bodies shared by both languages (`lang` prop) |
| `src/components/home`, `shop`, `product`, `account`, `admin`, `pro`, `cart`, `site`, `ui` | page parts |
| `src/components/fx/*` | the effects library (smooth scroll, arch, sparkles, aura, reel, words, cursor, intro …) |
| `src/content/*` | copy (`copy/*.ts`, fa/en same shape), the brand story (`copy/story.ts`), slots, starter catalogue and pictures |
| `src/lib/*` | server libraries: db, auth, Pro codes, catalogue, orders, media, members, settings, SMS, e-mail, SEO |
| `src/app/actions/*` | Server Actions (admin ones go through `guard()`) |
| `supabase/migrations/*` | idempotent SQL, run in name order |
| `public/brand/*` | the logo, vectorised 1:1 from the official artwork (normal and reverse) |
| `public/media/seed/*` | the starter photographs (responsive WebP) |

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # next typegen + tsc
npm test             # vitest
npm run build        # must pass with no environment variables
```

Environment variables are listed in `.env.example` (all optional for the build; the site runs on the starter catalogue until Supabase is connected).
