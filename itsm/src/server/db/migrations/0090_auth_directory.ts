// Sign-in with domain accounts, Windows single sign-on and the session policy of banks (docs/AD_FA.md):
//   · sm_sessions learns how a session was opened (auth_method: password, ldap, sso, proxy, device…), the organisation
//     a directory sign-in reaches alone (org_id) and its directory source, the login name typed (re-authentication
//     with the domain), when the person last proved who they are (reauth_at: sensitive administration asks again after
//     the organisation's minutes), the idle timeout it carries (minutes, 0 = none), whether the cookie lives only
//     until the browser closes, and why it was ended (idle, admin, single session, directory…).
//   · sm_auth_throttle — failed sign-ins counted per login name of a source, per client address and per source, with
//     the local lockout that keeps password spraying away from the domain controllers and the last time administrators
//     were told. Holds login names and addresses, never a password; read only by the server (RLS without policies).
//   · sm_directory_links.granted — what a directory sign-in granted through approved group mappings (roles, groups,
//     workspaces), so access is taken back when the person leaves the directory group.
export default /* sql */ `
alter table sm_sessions add column if not exists auth_method text;
alter table sm_sessions add column if not exists org_id uuid;
alter table sm_sessions add column if not exists source_id uuid;
alter table sm_sessions add column if not exists login text;
alter table sm_sessions add column if not exists reauth_at timestamptz;
alter table sm_sessions add column if not exists idle_minutes int not null default 0;
alter table sm_sessions add column if not exists browser_only boolean not null default false;
alter table sm_sessions add column if not exists revoke_reason text;
create index if not exists sm_sessions_org_idx on sm_sessions (org_id) where revoked_at is null;
create index if not exists sm_sessions_live_idx on sm_sessions (user_id, last_seen_at desc) where revoked_at is null;

create table if not exists sm_auth_throttle (
  key text primary key,
  org_id uuid,
  kind text not null,
  subject text,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists sm_auth_throttle_org_idx on sm_auth_throttle (org_id, updated_at desc);
alter table sm_auth_throttle enable row level security;

alter table sm_directory_links add column if not exists granted jsonb;
`;
