// The owner's guides say what the web version does (docs/SETUP_FA.md, docs/RELEASE_FA.md, CLAUDE.md,
// docs/spec/ENGINE.md): the limits each API function answers within, what a database time-out means for a save, why
// a role-level time-out does not end the stuck pooler backend of 1.1.3, the job queue's rules, and the Ignored Build
// Step the Vercel project runs. The numbers come from the files that set them where this tree has them.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXHAUSTED_BATCH, HEARTBEAT_MAX_MS, HEARTBEAT_MS, LOCK_MS } from "@server/jobs";
import { MIGRATIONS } from "@server/db/migrations";

const ROOT = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/**
 * A markdown section: from the heading that starts with `heading` to the next heading of the same level or higher (a
 * `# …` line inside a fenced code block, a shell comment, is no heading).
 */
function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`no heading «${heading}»`);
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  let fenced = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("```")) fenced = !fenced;
    const m = fenced ? null : /^(#+) /.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The row of SETUP_FA §۹'s table for an error code, as `(\`code\`)` names it. */
function row(guide: string, code: string): string {
  const line = guide.split("\n").find((l) => l.startsWith("|") && l.includes(`(\`${code}\`)`));
  if (!line) throw new Error(`no row for ${code}`);
  return line;
}

/** A route file's `maxDuration` (seconds): the function's cut on Vercel. */
function maxDuration(file: string): number {
  const m = /export const maxDuration = (\d+);/.exec(read(file));
  if (!m) throw new Error(`no maxDuration in ${file}`);
  return Number(m[1]);
}

describe("the web version's limits in the owner's guides", () => {
  it("names the deadline of each API function: 10 s before its own cut, the assistant's 300 s function too", () => {
    // src/server/cloud.ts requestDeadlineMs: a request is answered 503 `timeout` 10 s before the cut of the function it
    // runs in (app/api/o/[org]/ai passes its maxDuration to handleCloud) — not 50 s everywhere
    const deadlines = [join("app", "api", "[[...route]]", "route.ts"), join("app", "api", "o", "[org]", "ai", "[[...route]]", "route.ts")].map((f) => maxDuration(f) - 10);
    expect(deadlines).toEqual([50, 290]);
    const guide = read("docs", "SETUP_FA.md");
    const limits = section(guide, "### ۲-۶.");
    const timeout = row(guide, "timeout");
    const notes = section(read("docs", "RELEASE_FA.md"), "## کاریز ۱٫۱٫۴");
    const claude = read("CLAUDE.md").split("\n").find((l) => l.startsWith("- **The web version's database connection**")) ?? "";
    for (const s of deadlines) {
      expect(limits, `SETUP_FA §۲-۶ names ${s} s`).toContain(`${fa(s)} ثانیه`);
      expect(timeout, `the timeout row names ${s} s`).toContain(`${fa(s)} ثانیه`);
      expect(notes, `RELEASE_FA 1.1.4 names ${s} s`).toContain(`${fa(s)} ثانیه`);
      expect(claude, `CLAUDE.md names ${s} s`).toContain(`${s} s`);
    }
  });

  it("does not promise that a database time-out saved nothing: a lost answer may follow a commit", () => {
    // DB_TIMEOUT (no answer in 35 s) is given up on the client: an autocommit write or a COMMIT whose answer was lost
    // has been applied on the server, so repeating the save blindly can make it twice — like the request deadline's row
    const guide = read("docs", "SETUP_FA.md");
    for (const code of ["db_timeout", "timeout"]) expect(row(guide, code), code).toMatch(/پیش از تکرار صفحه را تازه کنید/);
    expect(row(guide, "db_timeout")).not.toMatch(/ذخیره نشده است/);
  });

  it("explains why neither role-level time-out ends the stuck «Supavisor, active, ClientRead» backend", () => {
    // PostgreSQL holds a statement time-out back while it reads the client's next message and acts on it only when one
    // arrives (the stuck backend waits for a Bind that never comes); idle_in_transaction_session_timeout is armed only
    // for a backend that is idle in a transaction, and this one is `active`
    const roles = read("docs", "SETUP_FA.md")
      .split("\n")
      .find((l) => l.startsWith("**تنظیم‌های نقش (کوئری ۵):**"));
    expect(roles).toBeDefined();
    expect(roles).not.toMatch(/نمی‌شمارد/);
    expect(roles).toMatch(/پیام بعدی سرویس‌گیرنده/);
    expect(roles).toMatch(/`idle_in_transaction_session_timeout` هم به آن نمی‌رسد[^.]*`active`/);
  });

  it("states the job queue's 1.1.5 rules in the engine's spec", () => {
    // one line per rule, whatever the wrapping of the markdown
    const jobs = section(read("docs", "spec", "ENGINE.md"), "## 8. Jobs").replace(/\s+/g, " ");
    // attempts count consecutive failures: a success or `{ again }` forgives the earlier ones (a long chain is never
    // worn down over its life)
    expect(jobs).toContain("`{ again: ms }` reschedules, and it or a success resets `attempts` (they count consecutive failures)");
    // a live job keeps its claim: the heartbeat renews the lock (the numbers src/server/jobs sets), save throws once lost
    expect([LOCK_MS, HEARTBEAT_MS, HEARTBEAT_MAX_MS]).toEqual([5 * 60_000, 60_000, 2 * 3600_000]);
    expect(jobs).toContain("a heartbeat renews the job's 5-minute lock every minute, for at most 2 hours from the claim");
    expect(jobs).toContain("throw `JobClaimLost` once another worker holds the job");
    // finish checks the claim: an outcome is written only by the worker that still holds the job
    expect(jobs).toContain("every outcome is written only while this worker holds the claim (`status = 'running' and locked_by = worker`), so a lost claim writes nothing");
    // a worker that stopped: its job is taken again while it has attempts left, else failed (failExhausted, a batch a
    // tick) and its kind's exhausted hook finalises its row or re-arms its chain
    expect(EXHAUSTED_BATCH).toBe(100);
    expect(jobs).toContain("the job is taken again while it has attempts left, else failed with `EXHAUSTED_ERROR` (`failExhausted`, 100 a tick)");
    expect(jobs).toContain("`registerJobHandler(kind, fn, { onExhausted })` or `registerJobExhausted(kind, hook)`");
    expect(jobs).toMatch(/The hook runs after the job's update, in the job's demo scope, its error logged: it puts the kind's row in a final state [^.]*or queues a chain's next round at its interval/);
    // never again 1.1.4's rule (an expired lock taken over whatever the job's attempts)
    expect(jobs).not.toMatch(/whatever (the job's|its) attempts/);
    // the web version's ticks: after a write when a job is due, from other traffic at most once a minute, the cron's
    expect(jobs).toContain("queueHasDue");
    expect(jobs).toContain("trafficTickDue");
    expect(jobs).toContain("cleanup: false");
  });

  it("tells the owner that a job whose worker stopped at its last allowed attempt is failed and counted, and the notes for Claude say so", () => {
    // SETUP_FA's reading of the queue query (§۹-۲, query 3): the live worker's heartbeat, a stalled job taken again,
    // failed at its last allowed attempt and counted in «سلامت سامانه» under the title the app shows
    const guide = read("docs", "SETUP_FA.md");
    const health = read("src", "server", "modules", "platform", "health.ts");
    const title = /const title = "([^"]+)";\s*\n\s*if \(!j\.exhausted_24h\)/.exec(health)?.[1] ?? "";
    expect(title).toBe("کارهای ناتمام در آخرین تلاش");
    const stalled = guide.split("\n").find((l) => l.startsWith("- در کوئری ۳،")) ?? "";
    expect(stalled).toContain(`کارگر زنده قفل ${fa(LOCK_MS / 60_000)} دقیقه‌ای کارش را هر دقیقه تمدید می‌کند`);
    expect(stalled).toContain(`وقتی قفل تمام شد کار دوباره گرفته و از نو اجرا می‌شود، و اگر آخرین تلاش مجازش بود «ناموفق» می‌شود و در «${title}» شمرده می‌شود`);
    // the health list a new installation should see includes that row
    expect(guide).toContain(`«${title}» «هیچ کاری در ۲۴ ساعت گذشته»`);
    // the notes for Claude: consecutive failures, the heartbeat, the claim-checked finish, failExhausted and the hook
    const claude = (read("CLAUDE.md").split("\n").find((l) => l.startsWith("- **The web version's job queue**")) ?? "").replace(/\s+/g, " ");
    expect(claude).toContain("`attempts` counts consecutive failures (done and `{ again }` reset it)");
    expect(claude).toContain("a heartbeat renews a running job's 5-minute lock every minute for at most `HEARTBEAT_MAX_MS` (2 h)");
    expect(claude).toContain("every outcome statement of `finish` checks the claim (`status = 'running' and locked_by = worker`) and a lost claim writes nothing");
    expect(claude).toContain("the job is taken again while it has attempts left, else `failExhausted` (100 a tick) fails it with `EXHAUSTED_ERROR` and runs its kind's exhausted hook");
    expect(claude).not.toMatch(/whatever its attempts/);
    // 1.1.4's notes still say what 1.1.4 did: it failed no job at its last attempt (1.1.5 does)
    const notes = section(read("docs", "RELEASE_FA.md"), "## کاریز ۱٫۱٫۴");
    const changelog = read("src", "server", "modules", "admin", "changelog.ts");
    const entry = changelog.slice(changelog.indexOf('version: "1.1.4"'), changelog.indexOf('version: "1.1.3"'));
    for (const [name, text] of [
      ["RELEASE_FA 1.1.4", notes],
      ["the 1.1.4 «تازه‌ها»", entry],
    ]) expect(text, name).not.toMatch(/آخرین تلاش مجاز/);
  });
});

describe("a release merged while production is rolled back", () => {
  // after an Instant Rollback Vercel stops putting new production deployments on the production domains: the merged
  // 1.1.4 is built and Ready, and 1.1.2 still answers, until a deployment is promoted (UI-6 of the 1.1.4 review)
  it("tells the owner to undo the rollback (promote the new deployment) and to check the version /api/health gives", () => {
    const notes = section(read("docs", "RELEASE_FA.md"), "## کاریز ۱٫۱٫۴");
    const first = notes.split("\n").find((l) => l.startsWith("- ")) ?? "";
    expect(first).toContain("Undo Rollback");
    expect(first).toContain("vercel promote");
    expect(first).toContain('"version":"1.1.4"');
    const rollback = section(read("docs", "SETUP_FA.md"), "### ۱۰-۱.").split("\n").find((l) => l.startsWith("- **برگرداندن نسخهٔ قبلی:**")) ?? "";
    expect(rollback).toContain("Undo Rollback");
    expect(rollback).toContain("Promote");
  });
});

describe("the heartbeat of SETUP_FA §۴-۱", () => {
  it("cleans pg_cron's history of its runs, which pg_cron never deletes (1,440 rows a day, each with the Bearer secret)", () => {
    // Supabase's own advice (Cron quickstart): a daily job deleting what is older than 7 days; removed with the heartbeat
    const guide = section(read("docs", "SETUP_FA.md"), "### ۴-۱.");
    expect(guide).toMatch(/select cron\.schedule\('itsm-tick-cleanup', '[^']+', \$\$delete from cron\.job_run_details where end_time < now\(\) - interval '7 days'\$\$\);/);
    expect(guide).toContain("select cron.unschedule('itsm-tick-cleanup');");
  });
});

describe("the Ignored Build Step itsm/vercel.json runs", () => {
  // a repository like this one: the itsm/ folder, another project's folder, and Vercel's variables; the command runs in
  // the Root Directory (itsm/) and Vercel builds on exit 1, cancels on exit 0 (any other code fails the deployment)
  function world() {
    const dir = mkdtempSync(join(tmpdir(), "itsm-ignore-"));
    // the children's whole environment, nothing of this process's own, typed as the ProcessEnv the options take: once
    // `npm run build` has written next-env.d.ts, Next's types make NODE_ENV one of its required keys, which these
    // children neither get nor need (a bare object literal then fails typecheck, TS2769)
    const only: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(dir, "gitconfig") };
    const env = only as NodeJS.ProcessEnv;
    const git =(...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, env, stdio: "pipe" }).toString().trim();
    const commit = (path: string) => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), `${path} ${Math.random()}`);
      git("add", "-A");
      git("commit", "-q", "-m", path);
      return git("rev-parse", "HEAD");
    };
    git("init", "-q");
    const c1 = commit("itsm/a.txt");
    const c2 = commit("itsm/b.txt");
    // the tip changes another project only (18 of the last 25 merges to main did)
    const c3 = commit("siraf/x.txt");
    const command = (JSON.parse(read("vercel.json")) as { ignoreCommand: string }).ignoreCommand;
    const run = (vars: { previous?: string; commit?: string; env?: string }): number => {
      try {
        execFileSync("sh", ["-c", command], {
          cwd: join(dir, "itsm"),
          stdio: "pipe",
          env: { ...env, VERCEL_GIT_PREVIOUS_SHA: vars.previous ?? "", VERCEL_GIT_COMMIT_SHA: vars.commit ?? c3, VERCEL_ENV: vars.env ?? "production" },
        });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    return { dir, c1, c2, c3, run, command };
  }

  it("builds a new project's first production deployment, a Redeploy of the current one and a change of itsm/", () => {
    const w = world();
    try {
      expect(w.command.length).toBeLessThanOrEqual(256);
      // a new project's first production deployment: no previous deployment, the tip touched another folder only
      expect(w.run({ previous: "" })).toBe(1);
      // a dashboard Redeploy of the deployment that is current: the previous successful deployment is that commit
      expect(w.run({ previous: w.c3, commit: w.c3 })).toBe(1);
      // something changed in itsm/ since the last successful deployment
      expect(w.run({ previous: w.c1 })).toBe(1);
      // the last deployed commit is not in Vercel's shallow clone: build rather than fail (git diff would exit 128)
      expect(w.run({ previous: "0123456789abcdef0123456789abcdef01234567" })).toBe(1);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("cancels a push that changed only another project, also a preview's first deployment", () => {
    const w = world();
    try {
      expect(w.run({ previous: w.c2 })).toBe(0);
      expect(w.run({ previous: "", env: "preview" })).toBe(0);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("the setup guide's Ignored Build Step", () => {
  it("quotes the command each vercel.json runs, verbatim", () => {
    // SETUP_FA §۲-۸ tells the owner to put the same command in the dashboard of a branch without vercel.json: it must be
    // the one itsm/vercel.json (first block) and the repository root's vercel.json (second block) hold
    const blocks = [...section(read("docs", "SETUP_FA.md"), "### ۲-۸.").matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1].trim());
    const own = JSON.parse(read("vercel.json")) as { ignoreCommand: string };
    const root = JSON.parse(read("..", "vercel.json")) as { ignoreCommand: string };
    expect(blocks).toEqual([own.ignoreCommand, root.ignoreCommand]);
  });
});

describe("the owner's first look at «سلامت سامانه» (SETUP_FA §۲)", () => {
  // «ساختار پایگاه داده» says «به‌روز (N مرحله)» with N = the app's migrations (platform/health.ts): 1.1.5's
  // 0105_demo_purge_sync made them ۲۹ and the guide still promised ۲۸, so a correct installation looked wrong
  it("names as many schema steps as the app has migrations", () => {
    expect(read("src", "server", "modules", "platform", "health.ts")).toContain("`به‌روز (${faDigits(MIGRATIONS.length)} مرحله)`");
    expect(read("docs", "SETUP_FA.md")).toContain(`«ساختار پایگاه داده» «به‌روز (${fa(MIGRATIONS.length)} مرحله)»`);
  });
});
