// Bank scale (docs/PERFORMANCE_FA.md): what the generated DDL and the engine's queries need on a large database.
//
// · pg_trgm, where the server offers it (PostgreSQL, Supabase): the trigram indexes of the numbered tables' search
//   documents (engine/ddl.ts `searchIndex`) make «contains» search an index lookup. PGlite (the Windows app) has no
//   pg_trgm in its build: nothing happens there and searches scan its small tables as before.
// · BRIN indexes on the time of append-only streams — journal, history, audit, notification log, finished jobs: a few
//   pages each, they serve time-window reports, retention clean-ups and archival without a btree per stream.
export default /* sql */ `
do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin
      create extension pg_trgm;
    exception when others then
      raise notice 'pg_trgm not installed: %', sqlerrm;
    end;
  end if;
end
$ext$;

create index if not exists sm_journal_created_brin on sm_journal using brin (created_at);
create index if not exists sm_history_at_brin on sm_history using brin (at);
create index if not exists sm_audit_at_brin on sm_audit using brin (at);
create index if not exists sm_notification_log_created_brin on sm_notification_log using brin (created_at);
`;
