// AI agents and the assistant that operates the app (docs/spec/AI.md §11.8). Proposals (sm_ai_actions) gain:
//   · the agent and the run that made one (`agent_id`, `agent_run_id`) — agents act through a service member of their
//     own, so `user_id` is that member and these columns say which agent it was;
//   · whom it is routed to (`route_users`, `route_groups`): the record's assignee and assignment group, or the agent's
//     approvers — the «پیشنهادهای هوش مصنوعی» inbox lists what is routed to a person (they still see a proposal only
//     when they may read its record and every field involved, and apply it with their own access); `route_only`: only
//     the people it is routed to may apply it (autonomy «اقدام پس از تأیید»: the agent's approvers);
//   · what applying it did row by row (`outcome`): a batch proposal reports every row's result.
// The agent definitions and their runs are engine tables (src/shared/tables/ai-agents.ts).
export default /* sql */ `
alter table sm_ai_actions add column if not exists agent_id uuid;
alter table sm_ai_actions add column if not exists agent_run_id uuid;
alter table sm_ai_actions add column if not exists route_users uuid[];
alter table sm_ai_actions add column if not exists route_groups uuid[];
alter table sm_ai_actions add column if not exists outcome jsonb;
alter table sm_ai_actions add column if not exists route_only boolean not null default false;
create index if not exists sm_ai_actions_agent_idx on sm_ai_actions (org_id, agent_id, created_at desc) where agent_id is not null;
create index if not exists sm_ai_actions_open_idx on sm_ai_actions (org_id, status, created_at desc) where status = 'proposed';
`;
