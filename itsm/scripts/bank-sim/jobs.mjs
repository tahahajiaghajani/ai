// The server's background work as the bank's administrator would look at it (docs/qa/BANK_SIM_FA.md): the demo pack's
// state and every job that is queued, running or failed, read from the installed server's database with its own
// connection settings (kariz.json; the application's role, never the superuser). The simulation prints it while a
// long `karizctl demo load / purge` runs and when one overruns its budget, so a stuck queue explains itself.
//
//   node jobs.mjs --config D:\Kariz\kariz.json [--out jobs.json]
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { parseArgs } from "./lib.mjs";

const a = parseArgs();
const conf = JSON.parse(readFileSync(String(a.config), "utf8").replace(/^\uFEFF/, ""));
const db = conf.db ?? {};
const sql = postgres({ host: db.host ?? "127.0.0.1", port: Number(db.port ?? 5432), database: db.database, user: db.user, password: db.password, max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  const packs = await sql`select org_id, state, size, error, progress->'memo'->'step' as step, progress->'purge' as purge, progress->'seeds_done' as seeds_done, updated_at from sm_demo_packs`;
  const busy = await sql`
    select kind, status, count(*)::int as n, min(run_at) as next_run, max(attempts) as attempts, max(max_attempts) as max_attempts,
           max(locked_until) as locked_until, (array_agg(last_error order by updated_at desc))[1] as last_error
      from sm_jobs where status in ('queued', 'running') group by kind, status order by n desc limit 40`;
  const failed = await sql`
    select kind, count(*)::int as n, (array_agg(last_error order by updated_at desc))[1] as last_error
      from sm_jobs where status = 'failed' and updated_at > now() - interval '2 hours' group by kind order by n desc limit 20`;
  const done = await sql`select kind, count(*)::int as n from sm_jobs where status = 'done' and done_at > now() - interval '5 minutes' group by kind order by n desc limit 10`;
  const out = { at: new Date().toISOString(), packs, busy, failed, done_last_5_min: done };
  if (a.out) writeFileSync(String(a.out), JSON.stringify(out, null, 2));
  const short = (s) => (s ? String(s).replace(/\s+/g, " ").slice(0, 160) : "");
  for (const p of packs) console.log(`demo pack: ${p.state} size=${p.size} step=${p.step ?? "-"} purge=${p.purge ?? "-"} seeds_done=${p.seeds_done ?? "-"} ${p.error ? `error=${short(p.error)}` : ""}`);
  for (const j of busy) console.log(`  ${j.status.padEnd(7)} ${String(j.n).padStart(5)} ${j.kind} (attempts ${j.attempts}/${j.max_attempts}, next ${j.next_run?.toISOString?.() ?? j.next_run}) ${short(j.last_error)}`);
  for (const j of failed) console.log(`  failed  ${String(j.n).padStart(5)} ${j.kind} ${short(j.last_error)}`);
  console.log(`  done in the last 5 minutes: ${done.map((d) => `${d.kind}=${d.n}`).join(", ") || "nothing"}`);
} finally {
  await sql.end({ timeout: 2 });
}
