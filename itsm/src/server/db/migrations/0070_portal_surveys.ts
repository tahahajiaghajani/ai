// Anonymous survey answers (docs/modules/portal_FA.md): held on the runtime that received them until at least five of
// a survey wait, then written as responses in one shuffled batch stamped with the day (src/server/modules/portal/
// surveys.ts) — so no time, id, number or revision ties a response to the invitation that was answered. Never synced,
// never read through the API.
export default /* sql */ `
create table if not exists sm_survey_held (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  survey_id uuid not null,
  payload jsonb not null
);
create index if not exists sm_survey_held_survey_idx on sm_survey_held (org_id, survey_id);
alter table sm_survey_held enable row level security;
`;
