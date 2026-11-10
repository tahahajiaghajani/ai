# Server edition — engineering notes

The third edition next to the web version (Next.js on Vercel + Supabase) and the Windows app (Electron + PGlite): one
MSI that installs everything on a Windows Server inside an air-gapped intranet; employees use the app in a browser at
`https://<host>`. The administrator's guide (Persian) is `docs/SERVER_FA.md`. Windows-facing names (MSI product,
services, folders, registry key, firewall rule) live only in `packaging/server/edition.json`; the UI keeps `APP_NAME`;
internal identifiers stay neutral (`sm_*`, `itsm.*`, `ITSM_*`).

## Layout

| Path | What |
|---|---|
| `src/server-edition/` | the runtime and `karizctl` (TypeScript, bundled to `app/server.cjs` and `app/karizctl.cjs`) |
| `src/server/net.ts` | the outbound network policy (`NetworkPolicy`, `lanAllowed`, `hostAllowed`, `networkFetch`, `checkOutboundHost`) |
| `src/server/blobs.ts` | the attachment-content store interface (`BlobStore`, `dbBlobStore`, `blobStore(cfg)`) |
| `packaging/server/` | `edition.json` (names), `externals.json` (bundle externals and native modules), `deps.json` (pinned binaries), `winsw/` (service templates), `wix/` (MSI), `scripts/` (PowerShell + `smoke.mjs`) |
| `scripts/build-server.mjs` | builds `server-dist/` (bundle, pre-compressed SPA, scripts, `karizctl.cmd`) |
| `tests/server-edition-*.test.ts` | unit/runtime tests; `server-edition-pg.test.ts` runs against a real PostgreSQL when `ITSM_PG_BIN` is set |

## Runtime (`src/server-edition`)

- **Process model** (`cluster.ts`, `worker.ts`, `main.ts`). The supervisor (KarizApp's process) waits for PostgreSQL,
  runs `migrate` once, makes sure a certificate exists (`tls.ts`), forks `workers` processes (default: one per core,
  2–16), restarts crashed workers with exponential backoff (exit code 78 = configuration error: not restarted), does
  rolling restarts (new worker reports `ready` before the old one stops) on request (`restart.request` file from
  `karizctl`, IPC from the setup after a certificate/host change, SIGHUP on Unix), broadcasts configuration reloads
  (`reload.request`, IPC), is the single writer of the rotating JSON log, aggregates worker metrics, and stops
  gracefully on SIGINT/SIGTERM/SIGBREAK (WinSW sends Ctrl+C). `--standalone` runs one process (dev, tests).
- **Worker** builds `createApp` in **cloud mode** (same auth and sessions, live pulse via `sm_org_sync`, every module)
  with: `network` (policy, air-gapped by default), `fetch: networkFetch(policy, fetch)`, `blobs` (disk store),
  `waitUntil` → scheduler wake-up, `server` bridge (health, meta info), `allowSignup: false`, `secretSource:
  "installation"`, `platformAdmins` from the configuration (mutated in place on reload). The database is wrapped by
  `WorkerMetrics.wrapDb` (queries in flight ≈ busy pool connections, slow calls).
- **HTTP front** (`front.ts`): request timing/metrics and slow-request log; security headers on every answer (CSP with
  `'self'` only and the SHA-256 of index.html's inline script, `frame-ancestors 'self'`, HSTS on HTTPS,
  X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP/CORP; a route's own CSP — attachment contents — is kept);
  `/api/cron/*` answers 404 (the scheduler leader ticks); `/api/ready` (DB, migrations, accepting) and
  `/api/server/metrics` (Prometheus text, bearer `metrics_token`); `bodyLimit` per request (`uploads.max_mb` for
  upload paths, `uploads.request_max_mb` otherwise); `/api/setup/*`; the setup gate (until the first account exists
  every API but health/ready/meta/setup answers 503 `setup_required`); brotli/gzip of API answers (never
  `text/event-stream`); the static SPA (`static.ts`: `.br`/`.gz` variants, immutable `/assets` and `/fonts`, no-cache
  index.html, weak ETags, SPA fallback, 404 for missing assets, no path escape).
- **Node-level request preparation**: unless `trust_proxy`, client-supplied `X-Forwarded-*`/`X-Real-IP`/`Forwarded`
  are dropped and `X-Real-IP` is set from the socket (rate limits and audit see the real client; `sameOrigin` cannot
  be fooled with a forged `X-Forwarded-Host`). TLS: PFX or PEM from the configuration, else a generated self-signed
  certificate (RSA 2048, SAN: public host, machine name, localhost, 127.0.0.1; own DER encoder) regenerated when the
  host changes or < 30 days remain; `minVersion: TLSv1.2`, ECDHE AEAD suites. HTTP → HTTPS 301 (probes
  `/api/health`, `/api/ready` stay on HTTP).
- **Scheduler** (`scheduler.ts`): every worker is a candidate; the leader holds `pg_try_advisory_lock(724150)` on a
  reserved connection of its own postgres.js client (`max: 1`), checks it each round (`pg_locks`), LISTENs on
  `itsm_tick`; followers retry every ~5 s. Only the leader calls `tick(cfg)` (the web version's tick; claims still use
  `FOR UPDATE SKIP LOCKED`); `waitUntil` on any worker → `NOTIFY itsm_tick` (coalesced) so record events run at once.
  The leader's chores (about once a minute): the daily backup when due. Leadership moves when the leader's
  connection drops (crash) or it stops (release).
- **Network policy**: `networkFetch` checks the URL host (names, `*.suffix`, IPs, CIDR; names resolved only when
  IP/CIDR entries exist) and follows redirects by hand checking every hop; refusals throw `OutboundBlockedError`
  (Persian message) and call `onRefused` (log + metrics). `airgap.ts` patches `net.Socket.prototype.connect` (covers
  undici/fetch, http, nodemailer, imapflow, the LDAP client): non-loopback, non-database, non-allowlisted destinations
  get `EAIRGAP` before connecting; names allowed only through IP entries are re-checked on the actual DNS answer.
- **Blob store** (`blobs-disk.ts`): `<blobs>/<org>/<sha[0:2]>/<sha256>`; `prepare` (outside the write transaction:
  hash check, size limit, write to `.incoming`, antivirus command with `{file}`, exit codes `infected_codes` →
  quarantine + 422, scanner failure → 503 or accept per `on_error`, atomic rename); `put` (same, idempotent);
  streamed `open` for downloads; `missing`/`has` by file existence. UNC paths work (the service's computer account).
- **Setup** (`setup.ts`): token issued by `karizctl setup-token` (only its SHA-256 in `kariz.json`, 14 days, URL in
  `<data>/setup-url.txt`); `/api/setup/state`, `/certificate` (multipart PFX or PEM, validated, saved under `tls/`,
  rolling restart), `/complete` (writes public URL, allowlist (+ SMTP and AI hosts), platform admin and backup folder
  first; then calls the app's own routes: `/auth/signup` (first account → platform admin), `/orgs`, `email_channel`,
  `ai/connections`; default plan → `enterprise`; consumes the token; returns the session cookie). Validation errors
  never leak whether a token is valid; attempts are rate-limited per IP.
- **Health** (`health.ts`, `GET /api/admin/server` for platform admins): DB version/size/connections/cache hit/slow
  statements (`pg_stat_statements`), disks (`statfs`), queue, workers (from the supervisor), backups, certificate,
  network policy and recent refusals, with Persian checks.
- **Backups** (`backup.ts`): `pg_dump -Fc -Z 6` into `<backups>/itsm-<label>-<stamp>/db.dump` + `manifest.json`,
  attachment files mirrored once into `<backups>/blobs`, verification (`pg_restore --list` entries/table data, every
  referenced content present), `<data>/last-backup.json`, pruning of automatic backups. Restore: new database from the
  dump as the superuser (ownership kept), then rename current → `<db>_before_restore_<stamp>` and new → `<db>`;
  missing blob files copied back.
- **PostgreSQL** (`pg.ts`, `pgtune.ts`): `initdb` (UTF8, `--locale-provider=icu --icu-locale=fa-IR` with C fallback,
  `--data-checksums`, SCRAM), `kariz-tuning.conf` from the pure tuner (memory share 0.6 since the app runs on the same
  host; `effective_io_concurrency = 0` on Windows; slow-statement logging without parameter values;
  `pg_stat_statements`; loopback only; no Unix socket), `kariz-local.conf` for the administrator, `pg_hba.conf`
  loopback + SCRAM, bootstrap of the app role/database/extensions (`pg_stat_statements`, `vector`, `pgcrypto`) as the
  superuser. `planPools`: `workers × (pool + 1) + 1 ≤ max_connections − reserve`. **The integrator aligns the tuner's
  numbers with `docs/PERFORMANCE_FA.md` (S3)**: edit `tunePostgres`/`planPools` and their tests only.
- **Credentials**: `kariz.json` holds the app secret, the metrics token and the application role's password (readable by
  `NT SERVICE\KarizApp`); the PostgreSQL superuser's password lives in `kariz-admin.json` next to it, readable by
  Administrators and SYSTEM only — `loadServerConfig` merges it when readable (karizctl as administrator), the
  application never has it, and `saveServerConfig` never writes it from a process that could not read it.
- **karizctl** (`ctl.ts`): status, services (`sc.exe`), backup/restore, reset-password, rotate-cert, allowlist,
  diagnostics (zip without secrets: redacted config, versions, readiness, migrations, non-default pg settings,
  activity, jobs, log tails with secret-looking values masked), setup-token, purge, and the installer steps (init,
  db-init, pg-conf, db-bootstrap, migrate, pg-start/stop, wait-ready). `--config <file>` everywhere; flags may precede
  the command.

## Hooks into shared code (minimal, for the integrator)

| File | Change |
|---|---|
| `src/server/context.ts` | `ServerConfig.network?`, `blobs?`, `server?` (+ `ServerEditionBridge`) |
| `src/server/net.ts` | the network policy section (additive) |
| `src/server/blobs.ts` (new) | `BlobStore`, `dbBlobStore`, `installBlobStore`, `blobStore` |
| `src/server/engine/attachments.ts` | contents through `blobStore(cfg)` (`prepare` before the write lock); `openAttachment` streams |
| `src/server/routes/records.ts` | the content route streams through `openAttachment` |
| `src/server/modules/ai/rag/registry.ts`, `modules/admin/backup.ts` | read/write contents through `blobStore()` |
| `src/server/app.ts` | `/api/meta` adds `edition` and `server` |
| `src/server/routes/admin.ts` | `GET /admin/server` → `cfg.server.health()` |
| `src/server/modules/platform/{health,console}.ts` | no Supabase size cap when `cfg.server` |
| `src/server/modules/ai/{connections,net}.ts` | `lanAllowed` instead of `mode` for provider fetch/base URLs; `presetBlocked` (internet presets unavailable when air-gapped); `lanFetch` maps refusals to `BlockedAddressError` |
| `src/server/modules/{notify/channels,notify/mail,flows/hooks,flows/http,integration/net,integration/hooks,integration/directory,cmdb/jobs}.ts` | `lanAllowed(cfg)` for LAN decisions; SMTP/IMAP/LDAP hosts through `checkOutboundHost` (CMDB URL sources: also fixes the web version refusing every safe public URL) |
| `src/ui/App.tsx`, `lib/session.tsx` | `/setup` picks `ServerSetup` for `edition === "server"`; `Meta.edition/server` |
| `src/ui/pages/admin/Admin.tsx` | «سلامت سرور» section (server edition only) |
| `src/ui/ai/settings/AiSettings.tsx` | air-gap note |

## Packaging and CI

- `scripts/build-server.mjs`: Vite build into `server-dist/app/public` (fails if index.html references an external
  origin), `.br`/`.gz` for every compressible file ≥ 1 KB, esbuild CJS bundles (externals from
  `packaging/server/externals.json`: `native` = optional lazily-loaded SSO modules (`kerberos`, `node-expose-sspi`)
  copied with their dependency closure when installed — their win32-x64 prebuilt binaries arrive with `npm ci` on the
  Windows runner, never at install time; `unused` = PGlite/Electron, neither bundled nor shipped).
- `fetch-deps.ps1`: Node.js portable, PostgreSQL 17 EDB binaries (bin/lib/share; pgAdmin, StackBuilder, docs and
  headers dropped; app-local VC++ runtime from Visual Studio's redist when missing), WinSW, WiX packages — all
  SHA-256-verified against `deps.json`, cached by its hash.
- `build-pgvector.ps1`: clone the pinned tag, verify the commit, `nmake /F Makefile.win` with `vcvars64` and
  `PGROOT` = the full EDB tree; `-AllowMissing` turns a failure into a warning + `PGVECTOR-NOT-INCLUDED.txt`.
- `build-msi.ps1`: WiX 5 from the verified local feed (`nuget.config` with only that source), extension DLLs from the
  verified packages; `Package.wxs` harvests the payload with `<Files>`, `MajorUpgrade AllowSameVersionUpgrades`,
  launch conditions, properties (HOSTNAME, PORT, HTTPPORT, DATADIR (+ RegistrySearch), CERTPATH, CERTPASSWORD
  (hidden, `HideTarget`), AIRGAPPED, WORKERS, REMOVEDATA), deferred `WixQuietExec` actions: `install.ps1`
  (install/re-install/upgrade), `uninstall.ps1 -Upgrade` (old version's side: pre-upgrade backup, a failure stops the
  upgrade), `uninstall.ps1` (removal; never blocks it).
- `install.ps1` (Windows PowerShell 5.1, idempotent): prerequisites (build ≥ 17763, memory, disk, ports), `karizctl
  init` (secrets kept), certificate, WinSW services with virtual accounts + `sc failure`, ACLs (data folder: Admins,
  SYSTEM, `NT SERVICE\KarizApp` modify; `db`: `NT SERVICE\KarizDB` only; `kariz.json`: Admins, SYSTEM, app),
  `db-init`/`pg-conf` (disk media detected), start DB, bootstrap, migrate, firewall rule, machine env/PATH, registry,
  start app, `wait-ready`, setup token. Logged to `<data>\logs\install-<time>.log` and the MSI log.
- CI (`.github/workflows/itsm.yml`): job `server` on `windows-latest` (build, fetch, pgvector, MSI twice — the second
  build has the same version and another ProductCode, for a real major upgrade), `smoke-test.ps1`: Windows Firewall
  default outbound **Block** (only the runner's own executables and DNS allowed; verified with a request that must
  fail), silent install, `smoke.mjs` (ready, headers, setup gate, setup through its API, sign-in, incident create/open,
  air-gap refusal, «سلامت سرور»), backup, the same MSI again (idempotent), the upgrade MSI (pre-upgrade backup checked),
  smoke again, diagnostics, uninstall keeping data; firewall restored in `finally` and in an `always()` step. Job
  `server-publish` (after `windows` and `server`) uploads the MSI to the release the desktop job created.

## Testing

`tests/server-edition-core.test.ts` (tuner, pools, config, policy, socket guard with real fetch, metrics, logs, zip,
CLI args), `tests/server-edition-runtime.test.ts` (TLS incl. handshake and PFX, disk store + fake scanner, static and
front, scheduler election with a fake lock, setup through its API on PGlite), `tests/server-edition-pg.test.ts`
(`ITSM_PG_BIN`; locally as root also `ITSM_PG_RUNAS=nobody`): karizctl install steps, two HTTPS instances on one
database with exactly one leader, setup, records, air gap, the Windows app's sync against the server, verified backup
and restore. The PowerShell scripts run only on Windows CI.

## Known limits / open issues

- Uploads are bounded and buffered once per request (multipart parsing in the shared route); the disk store writes
  and scans files outside the write transaction and downloads stream. A streaming multipart parser would remove the
  buffer.
- The Windows app's sync uses Node's CA list: a bank CA must be added with `NODE_EXTRA_CA_CERTS` (GPO). Passing
  `--use-system-ca` to the app's utility process would make it automatic (desktop owner).
- Orphaned blob files (attachments deleted for good) are not garbage-collected yet; the blob mirror of backups keeps
  every content ever stored.
- The sizing table and tuner numbers are estimates until `docs/PERFORMANCE_FA.md` (S3) has load-test results.
