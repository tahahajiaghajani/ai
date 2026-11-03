// 0019: keys of custom price sources (gold board «منبع دلخواه», exchange board «منابع سفارشی»). Some free price
// services (EZRate, Servix) take their key only in a request header; others (Navasan) in the URL, now written with
// {key}. The settings (synced) keep only the header name and the URL with {key}; the key itself lives here, one per
// business, board and origin («https://api.ezrate.me»), encrypted with this runtime's secret like AI keys. The
// table is local to each runtime (never synced): the web version and the Windows app each keep their own key, so a
// quota-limited key saved on one of them keeps that service on that one. A key is sent only to its own origin.
export default /* sql */ `
create table if not exists tz_price_keys (
  org_id uuid not null references tz_orgs(id) on delete cascade,
  board text not null,
  origin text not null,
  secret_enc text not null,
  key_hint text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, board, origin)
);

-- Supabase: reachable only through the app's own server connection
alter table tz_price_keys enable row level security;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table tz_price_keys from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table tz_price_keys from authenticated;
  end if;
end
$do$;
`;
