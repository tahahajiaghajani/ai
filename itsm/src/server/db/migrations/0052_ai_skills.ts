// AI skills (docs/spec/AI.md §11): proposals a skill makes are tied to the record they would change. A suggestion of
// field values, a drafted note or a drafted record is stored in sm_ai_actions like the assistant's proposals, with the
// record (`record_table`, `record_id`), the fields it touches (`fields`), the run it came from and who made it — the
// member who ran the skill, or the «دستیار هوش مصنوعی» service member for skills an event or a schedule started.
// Such a proposal is visible to whoever may read that record and every field involved, and is applied by a person
// with their own access. The skill tables themselves are engine tables (src/shared/tables/ai.ts).
export default /* sql */ `
alter table sm_ai_actions add column if not exists record_table text;
alter table sm_ai_actions add column if not exists record_id uuid;
alter table sm_ai_actions add column if not exists fields text[];
alter table sm_ai_actions add column if not exists skill_run_id uuid;
-- person | service
alter table sm_ai_actions add column if not exists principal text;
create index if not exists sm_ai_actions_record_idx on sm_ai_actions (org_id, record_table, record_id, created_at desc) where record_id is not null;
`;
