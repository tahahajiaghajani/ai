// Speed of the consoles' job summary (docs/qa/PERFORMANCE_E2E_FA.md §2): «failed in the last 24 hours» of an
// organisation (and of the platform) scanned every job the queue keeps — done jobs stay three days, 150,000 rows after
// the bank demo pack «متوسط» (55 ms, a parallel sequential scan; seconds with a bank's volume). Failed jobs are few:
// a partial index answers the count from them alone and costs nothing to the jobs that succeed.
export default /* sql */ `
create index if not exists sm_jobs_failed_idx on sm_jobs (org_id, done_at) where status = 'failed';
`;
