-- «ITSM» migration 0045_knowledge — مدیریت دانش: جریان رویدادهای دانش (جست‌وجو، بازدید، رأی، پیوند، حل بدون درخواست)
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0045_knowledge — مدیریت دانش: جریان رویدادهای دانش (جست‌وجو، بازدید، رأی، پیوند، حل بدون درخواست)
-- ---------------------------------------------------------------------------
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

insert into sm_migrations (id) values ('0045_knowledge') on conflict (id) do nothing;
