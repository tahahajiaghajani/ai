# Click-through QA — every screen

<!-- manual:start -->
## How it runs

`npm run qa:crawl` (`scripts/ui-crawl.mjs`) builds the UI, starts the Windows app's local server on PGlite with a fresh
data directory (what the owner runs on the desktop), creates the platform owner, the organisation (seeded like every
new organisation), an IT agent (access preset «کارشناس پشتیبانی») and a requester («درخواست‌دهنده») and a few
records (an incident, a problem, a change, a release on the roadmap, a «کار», an article, a CI). It signs in through
the login form as each of them and visits:

- **administrator** — every route the UI registry registers (`src/ui/modules/*/index.tsx` through
  `src/ui/modules/registry.tsx`, bundled for Node with esbuild — no hand list), the requester portal's pages
  (`portal/*`), the platform console (`/admin/*`), `/orgs`, `/orgs/new`; then the parameterised pages under the first
  record of their list (`incidents/:id/war-room`, `flows/:id/design`, `catalog-items/:id/builder`…);
- **agent** and **requester** — the pages their own sidebar shows them (the registry's nav filtered by their grants
  with the shell's own `gateAllows`), their home page and the portal;
- **signed out** — `/login`, `/signup`, `/recover`, `/setup` and an unknown published page (`/p/…`).

On each page it records console errors, uncaught exceptions, the crash screen (`[data-crash]`), «… پیدا نشد» /
«در دسترس نیست» and load-failed states, failed API calls (4xx/5xx; a 403 counts only for the administrator — for the
other roles it is listed as expected), loaders still on screen after 15 s, and horizontal overflow at 390 px for the
main pages of every space. On record lists it clicks «… تازه» (a form must render) and opens the first record (the
record page, then every tab); on other pages it clicks the primary header action, the first timeline bar, board card
or calendar entry, and the first link.

Options: `--base <url>` (a running server), `--roles admin,agent,requester`, `--only <regex>` / `--skip <regex>`,
`--from <route>` / `--before <route>` (a long run in parts), `--merge` (re-checked pages replace their rows in the
previous report), `--no-records`, `--no-actions`, `--mobile main|all|none`, `--quick` (the CI smoke run: main pages,
consoles, portal and sign-in pages; the job `clickthrough` of `.github/workflows/itsm.yml`). A full run takes about an
hour on a busy 4-vCPU machine; it uses one headless Chromium and replaces a tab, context or browser that crashes.

Not reached: the server edition's own pages (`/admin/server`, the server `/setup`) need the server edition; cloud
mode needs PostgreSQL (`scripts/pg-local.mjs`) and was not crawled in this round.

## Findings of this round (1.1-beta)

Found by the crawler (and by reading the code around each finding), fixed on `itsm-qa` with a regression test
each (`tests/ui-clickthrough.test.ts` unless named).

| Route | Role | Problem | Status |
|---|---|---|---|
| `releases/roadmap` → «انتشار تازه», a release bar | admin | relative navigation: «این صفحه پیدا نشد» | fixed in the base (2d5fbe3, `tests/ui-absolute-links.test.ts`); re-checked by the crawler (action and item steps) |
| `releases/roadmap` | all | the legend's swatches used the timeline band class (`position: absolute; inset-block: 0`) and floated as tall translucent bars over the page title | fixed: legend swatches (`rk-sw`) |
| `releases/roadmap` (and every timeline) | all | the first month's name was cut at the timeline's edge («بان» for «آبان») | fixed: month names start at their first day |
| `releases/roadmap` | all | a release saved without a planned release date has no bar, with no word about it — the roadmap looked empty after «انتشار تازه» | fixed: «N انتشار باز تاریخ عرضهٔ برنامه‌ریزی‌شده ندارد…» with a link to them (`tests/release-deploy.test.ts`) |
| `releases/roadmap` | all | a roadmap that did not load gave no reason and no retry | fixed |
| `kb/articles`, `kb/a` → «مقالهٔ دانش تازه» | admin | opened the reading view with the id «new»: «این مقاله پیدا نشد», 400 | fixed: `newPath` of record extensions → the article editor |
| documents, dashboards (latent, same cause) | admin | `docs/d/new`, `analytics/dashboards/new` would read «new» as an id | fixed: `newPath` → their libraries |
| `portal-admin/invitations` → «دعوت به نظرسنجی تازه» | admin | the portal's survey page asked for survey «new»: 400, «بارگذاری نشد» | fixed |
| system-written lists: `itam/reconcile-runs`, `security/verifications`, `grc/acks`, `portal-admin/responses`, `portal-admin/identities`… | admin | «… تازه» opened a form with nothing to fill in; «ثبت» was refused | fixed in the record kit: no «… تازه», import or «+» without an enterable field; the form's address explains |
| `flows`, `schedules`, `flow-connections`, `sla/business-rules`, `sla/assignment-rules`, `sla/priority-matrices`, `sla/ui-policies`, `notify/email`, `notify/channels`, `notify/templates`, `cmdb/settings`… | agent | listed in the agent's sidebar, but the server refuses the table: «فهرست پیدا نشد» | fixed: a table's nav item needs its own access area unless the module names a gate; every built-in role checked |
| `kb/settings` (knowledge manager), `slm/xla-scores` (service owner) | other roles | module gates disagreed with the table's area | fixed |
| `cmdb/query` → «اجرا» | admin | 400 for the empty query | fixed: «اجرا» waits for a class, condition or step (rule shared with the server) |
| any page | all | no error boundary: one render error blanked the whole app until a reload | fixed: every page and the app render inside `PageBoundary` |
| `itam/*` | — | reported to D3 (ITAM is theirs): see «Open» below | open |

### Open

- Cloud mode (Next.js on PostgreSQL) was not crawled: it needs a `next build` and a PostgreSQL cluster beside the
  crawl on a shared machine; the same UI and API run in desktop mode.
- Public pages with a token (`/p/kb/:token`, `/p/survey/:token`, `/p/ack/:token`) need a published link; only the
  public «not found» page is checked.
- The server edition's own pages (`/admin/server`, its `/setup`) need the server edition.
- Renderer crashes under memory pressure on the shared build machine are retried on a fresh tab; a page that crashed
  twice is listed as a problem of the run, not of the page (each one rendered when opened alone).
<!-- manual:end -->
