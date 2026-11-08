// Knowledge management: the knowledge event stream (docs/modules/knowledge_FA.md «رویدادها»). Append-only rows of what
// people did with knowledge — searches (the normalised query and the number of results), article views, clicks on
// results, votes, flags, links to records, «مشکلم حل شد» deflections, suggestions shown next to records — from which
// search analytics, popularity, deflection and the dashboards are computed. Local to each runtime, like the AI index:
// each side counts what happened on it (the records the stream refers to travel by sync as usual). Retention is the
// module's setting (`kb_config.events_days`, the sweep deletes older rows).
export default /* sql */ `
create table if not exists sm_kb_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  -- search | view | click | vote | rating | flag | link | unlink | deflect | suggest | create | attest | tree
  kind text not null,
  user_id uuid,
  -- the browser session (deflection: search → view → no request)
  session_id text,
  -- requester | agent
  persona text,
  -- portal | record | search | chat | api
  channel text,
  article_id uuid,
  record_table text,
  record_id uuid,
  -- the search form of the query (Persian-normalised) and how many results it found
  query text,
  results int,
  position int,
  value int,
  data jsonb
);
create index if not exists sm_kb_events_org_at_idx on sm_kb_events (org_id, at desc);
create index if not exists sm_kb_events_article_idx on sm_kb_events (org_id, article_id, at desc) where article_id is not null;
create index if not exists sm_kb_events_user_idx on sm_kb_events (org_id, user_id, at desc) where user_id is not null;
create index if not exists sm_kb_events_kind_idx on sm_kb_events (org_id, kind, at desc);
alter table sm_kb_events enable row level security;
`;
