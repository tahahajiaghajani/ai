-- CELIN website — hardening (October 2026). Idempotent: safe to run more than once. The site keeps working
-- before this file has run; it adds the rules below once it has.
--
-- 1. celin_users.password_from_code: a password a member set while signed in with only their Pro code. When
--    the admin revokes or replaces that code, the password is removed again (a leaked code cannot be turned
--    into a lasting password).
-- 2. celin_set_order_status: order status rules. A cancelled order stays cancelled; a shipped order can only
--    be cancelled, and then its pieces do not go back to stock (they have left the shop); cancelling a line
--    whose option was deleted meanwhile no longer adds its quantity to the product's own stock; a call that
--    changes nothing returns 'unchanged' (so the member is not told about a change that did not happen).
-- 3. Pro codes no longer stay in plain text in the inbox: they are replaced by a placeholder that the site
--    fills with the member's current code when it is read.
-- 4. celin_schema_version(): lets Admin → Connections see that this file has run.

-- ------------------------------------------------------------------ 1. accounts
alter table public.celin_users add column if not exists password_from_code boolean not null default false;

-- ------------------------------------------------------------------ 2. order status rules
create or replace function public.celin_set_order_status(p_order uuid, p_status text, p_note text, p_actor text, p_only_from text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order celin_orders%rowtype;
  v_line record;
begin
  if p_status not in ('pending', 'packing', 'ready', 'shipped', 'cancelled') then
    raise exception 'bad_status';
  end if;
  select * into v_order from celin_orders where id = p_order for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.status = p_status then
    return 'unchanged';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;
  if p_only_from is not null and v_order.status <> p_only_from then
    raise exception 'status_changed';
  end if;
  -- shipped is final: it can only be cancelled (e.g. a parcel that never arrived), never moved back
  if v_order.status = 'shipped' and p_status <> 'cancelled' then
    raise exception 'bad_transition';
  end if;

  -- the pieces go back to stock only while they are still in the shop
  if p_status = 'cancelled' and v_order.status in ('pending', 'packing', 'ready') then
    for v_line in select variant_id, product_id, qty, variant_fa from celin_order_items where order_id = p_order loop
      if v_line.variant_id is not null then
        update celin_variants set stock = stock + v_line.qty, updated_at = now() where id = v_line.variant_id;
      elsif v_line.product_id is not null and coalesce(v_line.variant_fa, '') = '' then
        -- a line ordered as an option whose option was deleted since then has nowhere to go back to
        update celin_products set stock = stock + v_line.qty where id = v_line.product_id;
      end if;
    end loop;
  end if;

  update celin_orders set
    status = p_status,
    status_changed_at = now(),
    updated_at = now(),
    cancel_reason = case when p_status = 'cancelled' then left(coalesce(p_note, ''), 500) else cancel_reason end
  where id = p_order;
  insert into celin_order_events (order_id, status, note, actor)
  values (p_order, p_status, left(coalesce(p_note, ''), 1000), coalesce(nullif(p_actor, ''), 'admin'));
  return p_status;
end;
$$;

revoke all on function public.celin_set_order_status(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.celin_set_order_status(uuid, text, text, text, text) to service_role;

-- ------------------------------------------------------------------ 3. no codes in the inbox
update public.celin_messages
set
  body_fa = regexp_replace(body_fa, chr(8206) || '?[0-9]{4} [0-9]{4} [0-9]{4}', '{{pro-code}}', 'g'),
  body_en = regexp_replace(body_en, '[0-9]{4} [0-9]{4} [0-9]{4}', '{{pro-code}}', 'g')
where kind = 'pro'
  and (body_fa ~ '[0-9]{4} [0-9]{4} [0-9]{4}' or body_en ~ '[0-9]{4} [0-9]{4} [0-9]{4}');

-- ------------------------------------------------------------------ 4. version marker
create or replace function public.celin_schema_version()
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select 20261024;
$$;

revoke all on function public.celin_schema_version() from public, anon, authenticated;
grant execute on function public.celin_schema_version() to service_role;
