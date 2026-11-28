// The job queue's last words, owed until they are said (Kariz 1.1.5, src/server/jobs/index.ts): a job that ended without
// finishing — its worker stopped at its last allowed attempt, its handler threw then, or an administrator canceled it
// while it was queued — owes its kind's exhausted hook, which puts the kind's own row in a final state or re-arms its
// chain. The statement that fails the job records the debt (`hook_due`: why it ended, `hook_tries`: tries so far); the
// hook's success clears it, and a later tick tries a hook that failed (a transient database error) or never ran (the
// web version's time limit, the app or the server closing meanwhile) again, a few times, before it is given up. The
// partial index answers the ticks' look for such jobs from the few failed jobs that owe one (none, nearly always).
export default /* sql */ `
alter table sm_jobs add column if not exists hook_due text;
alter table sm_jobs add column if not exists hook_tries int not null default 0;
create index if not exists sm_jobs_hook_due_idx on sm_jobs (updated_at) where status = 'failed' and hook_due is not null;
`;
