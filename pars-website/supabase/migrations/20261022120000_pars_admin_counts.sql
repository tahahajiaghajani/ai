-- Pars website — admin panel counts (idempotent). Run in Supabase → SQL Editor after 20261022090000_pars_site.sql.
-- The dashboard and sidebar badges count in the database: PostgREST returns at most 1000 rows per read,
-- so counting downloaded rows was wrong on busy sites. Without this function the panel falls back to
-- head-count queries (sessions and the average rating then come from the newest 1000 rows).

create or replace function public.pars_admin_counts(p_open text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tickets', (
      select jsonb_build_object(
        'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from pars_tickets group by status) s), '{}'::jsonb),
        'overdue', count(*) filter (where status = any (p_open) and first_response_at is null and due_at < now()),
        'week', count(*) filter (where created_at >= now() - interval '7 days'),
        'avgRating', avg(rating)::float8
      )
      from pars_tickets
    ),
    'chats', (
      select jsonb_build_object(
        'today', count(*) filter (where created_at >= now() - interval '1 day'),
        'week', count(*),
        'unknown', count(*) filter (where unknown and not reviewed),
        'negative', count(*) filter (where rating = -1 and not reviewed),
        'sessions', count(distinct session_id)
      )
      from pars_chat_logs
      where created_at >= now() - interval '7 days'
    )
  );
$$;

revoke all on function public.pars_admin_counts(text[]) from public, anon, authenticated;
-- the server (service-role key) keeps execute rights even where default privileges differ
grant execute on function public.pars_admin_counts(text[]) to service_role;
