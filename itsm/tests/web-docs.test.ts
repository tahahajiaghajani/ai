// The owner's guides say what the web version does (docs/SETUP_FA.md, docs/RELEASE_FA.md, CLAUDE.md): the limits each
// API function answers within, what a database time-out means for a save, and why a role-level time-out does not end the
// stuck pooler backend of 1.1.3. The numbers come from the files that set them where this tree has them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** A markdown section: from the heading that starts with `heading` to the next heading of the same level or higher. */
function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`no heading «${heading}»`);
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]);
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
});

