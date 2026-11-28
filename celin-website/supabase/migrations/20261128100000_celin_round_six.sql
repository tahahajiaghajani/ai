-- CELIN — the owner's sixth round of notes. Idempotent; safe to run more than once.
--
-- 1. The home opening («سرآغاز») turns: celin_slots.gallery holds the ordered pictures of a gallery slot
--    (home.hero.a), any number of them; null = never set (the site keeps the former three pictures).
-- 2. Collections: «میرا», announced «به‌زودی» by the fifth round, goes — only while no product points to it.
-- 3. Colour options: celin_variants.options = one combination of the product's option axes, by key of the colour
--    lists the admin keeps in Settings ({"plating":"gold","stone":"white","leather":"black"}; {} = an option of the
--    older plain list). The site writes name_fa / name_en / swatch of a combination, so orders copy them as before.
-- 4. Packs: celin_products.packs = how a piece is sold: 1 = single («تک»), 2–5 = a pack of that many pieces of the
--    model in as many sizes, one of each, at that many times the price of a piece. celin_order_items.qty stays in
--    pieces and celin_order_items.pack records the pack (packs = qty / pack), so totals, stock and restocking
--    on cancel stay as they are.
-- 5. celin_place_order(…, p_pricing, p_expect):
--    - p_items lines may carry "pack" (default 1): qty is in pieces and must be a whole number of packs, and the
--      pack must be one the product is sold in;
--    - p_pricing may carry "sale": {"pct": 1–90, "fa": title, "en": title} — the special-day discount of
--      Settings, taken off every piece after the quantity step: round(price × pct × (100 − sale) / 10000);
--    - p_expect is the total the site computed and the member confirmed: when the database's own total differs,
--      nothing is placed ('price_changed'), so a member is never charged anything but what was shown;
--    - the order keeps what was applied in pricing (sale, and the subtotal at the step before the sale).
--    The five-argument function is dropped: it knew neither packs nor the sale (an older deployment of the site
--    can no longer place orders). Until this file has run, the new site places orders of single pieces without
--    a sale through it — it charges those alike — and refuses the rest; the sale can be switched on only after.

-- ------------------------------------------------------------------ 1. the turning opening
alter table public.celin_slots add column if not exists gallery uuid[];

-- ------------------------------------------------------------------ 2. «میرا»
do $$
begin
  if exists (select 1 from public.celin_migrations where name = '20261128100000_celin_round_six') then
    return; -- applied before: a collection the admin later makes at the same address stays
  end if;
  delete from public.celin_collections k
  where k.slug = 'mira'
    and not exists (select 1 from public.celin_products p where p.collection_id = k.id);
end $$;

-- ------------------------------------------------------------------ 3. colour options
alter table public.celin_variants add column if not exists options jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'celin_variants_options_check') then
    alter table public.celin_variants add constraint celin_variants_options_check check (jsonb_typeof(options) = 'object');
  end if;
end $$;

-- ------------------------------------------------------------------ 4. packs
alter table public.celin_products add column if not exists packs smallint[] not null default '{1}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'celin_products_packs_check') then
    alter table public.celin_products add constraint celin_products_packs_check
      check (cardinality(packs) between 1 and 5 and packs <@ '{1,2,3,4,5}'::smallint[]);
  end if;
end $$;
alter table public.celin_order_items add column if not exists pack smallint not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'celin_order_items_pack_check') then
    alter table public.celin_order_items add constraint celin_order_items_pack_check check (pack between 1 and 5 and qty % pack = 0);
  end if;
end $$;

-- ------------------------------------------------------------------ 5. the order function
create or replace function public.celin_place_order(p_user uuid, p_items jsonb, p_customer jsonb, p_note text, p_pricing jsonb, p_expect bigint)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_step jsonb;
  v_prod celin_products%rowtype;
  v_var celin_variants%rowtype;
  v_qty integer;
  v_pack integer;
  v_price bigint;
  v_list bigint;
  v_stepped bigint;
  v_unit bigint;
  v_list_pct integer;
  v_pct integer;
  v_step_min integer;
  v_step_pct integer;
  v_sale integer := 0;
  v_sale_fa text := '';
  v_sale_en text := '';
  v_pieces integer := 0;
  v_sub bigint := 0;
  v_list_sub bigint := 0;
  v_step_sub bigint := 0;
  v_count integer := 0;
  v_id uuid;
  v_code text;
  v_img jsonb;
  v_has_variants boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'too_many_items';
  end if;
  if not exists (select 1 from celin_users where id = p_user and not disabled) then
    raise exception 'no_account';
  end if;
  begin
    v_list_pct := (p_pricing ->> 'list')::integer;
  exception when others then
    raise exception 'bad_pricing';
  end;
  if v_list_pct is null or v_list_pct < 100 or v_list_pct > 1000 or coalesce(p_pricing ->> 'level', '') not in ('member', 'pro') then
    raise exception 'bad_pricing';
  end if;
  -- the special-day discount, taken off every piece after the quantity step
  if jsonb_typeof(p_pricing -> 'sale') = 'object' then
    begin
      v_sale := coalesce((p_pricing #>> '{sale,pct}')::integer, 0);
    exception when others then
      raise exception 'bad_pricing';
    end;
    if v_sale < 0 or v_sale > 90 then
      raise exception 'bad_pricing';
    end if;
    v_sale_fa := left(coalesce(p_pricing #>> '{sale,fa}', ''), 80);
    v_sale_en := left(coalesce(p_pricing #>> '{sale,en}', ''), 80);
  end if;
  -- the pieces of the whole order decide the step; a line's qty is in pieces, a whole number of its packs
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_qty := (v_item ->> 'qty')::integer;
      v_pack := coalesce(nullif(v_item ->> 'pack', '')::integer, 1);
    exception when others then
      raise exception 'bad_qty';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 999 then
      raise exception 'bad_qty';
    end if;
    if v_pack < 1 or v_pack > 5 or v_qty % v_pack <> 0 then
      raise exception 'bad_pack';
    end if;
    v_pieces := v_pieces + v_qty;
  end loop;
  v_pct := v_list_pct;
  if jsonb_typeof(p_pricing -> 'steps') = 'array' then
    for v_step in select value from jsonb_array_elements(p_pricing -> 'steps') loop
      begin
        v_step_min := (v_step ->> 0)::integer;
        v_step_pct := (v_step ->> 1)::integer;
      exception when others then
        raise exception 'bad_pricing';
      end;
      if v_step_min is null or v_step_pct is null or v_step_pct < 100 then
        raise exception 'bad_pricing';
      end if;
      if v_pieces >= v_step_min and v_step_pct < v_pct then
        v_pct := v_step_pct;
      end if;
    end loop;
  end if;

  loop
    v_code := 'CL-' || lpad((floor(random() * 1000000))::integer::text, 6, '0');
    exit when not exists (select 1 from celin_orders where code = v_code);
  end loop;

  insert into celin_orders (code, user_id, customer, note)
  values (v_code, p_user, coalesce(p_customer, '{}'::jsonb), left(coalesce(p_note, ''), 2000))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::integer;
    v_pack := coalesce(nullif(v_item ->> 'pack', '')::integer, 1);
    select * into v_prod from celin_products
    where id = nullif(v_item ->> 'product_id', '')::uuid and status = 'published'
    for update;
    if not found then
      raise exception 'product_unavailable:%', v_item ->> 'product_id';
    end if;
    if not (v_pack::smallint = any (coalesce(v_prod.packs, '{1}'::smallint[]))) then
      raise exception 'pack_unavailable:%', v_prod.id;
    end if;
    select exists (select 1 from celin_variants where product_id = v_prod.id) into v_has_variants;
    select to_jsonb(m) - 'id' - 'created_at' - 'bytes' - 'alt_fa' - 'alt_en' into v_img
    from celin_media m where m.id = v_prod.images[1];

    if coalesce(v_item ->> 'variant_id', '') <> '' then
      select * into v_var from celin_variants
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_prod.id
      for update;
      if not found then
        raise exception 'variant_unavailable:%', v_item ->> 'variant_id';
      end if;
      v_price := coalesce(v_var.price, v_prod.price);
      if v_price is null then
        raise exception 'no_price:%', v_prod.id;
      end if;
      if v_var.stock < v_qty then
        raise exception 'out_of_stock:%', v_var.id;
      end if;
      update celin_variants set stock = stock - v_qty, updated_at = now() where id = v_var.id;
      if v_var.image_id is not null then
        select to_jsonb(m) - 'id' - 'created_at' - 'bytes' - 'alt_fa' - 'alt_en' into v_img
        from celin_media m where m.id = v_var.image_id;
      end if;
      v_list := round(v_price * v_list_pct / 100.0)::bigint;
      v_stepped := round(v_price * v_pct / 100.0)::bigint;
      v_unit := round(v_price * v_pct * (100 - v_sale) / 10000.0)::bigint;
      insert into celin_order_items (order_id, product_id, variant_id, name_fa, name_en, variant_fa, variant_en, sku, slug, image, unit_price, list_price, qty, pack)
      values (v_id, v_prod.id, v_var.id, v_prod.name_fa, v_prod.name_en, v_var.name_fa, v_var.name_en,
              coalesce(nullif(v_var.sku, ''), v_prod.sku), v_prod.slug, v_img, v_unit, v_list, v_qty, v_pack);
    else
      if v_has_variants then
        raise exception 'variant_required:%', v_prod.id;
      end if;
      v_price := v_prod.price;
      if v_price is null then
        raise exception 'no_price:%', v_prod.id;
      end if;
      if v_prod.stock < v_qty then
        raise exception 'out_of_stock:%', v_prod.id;
      end if;
      update celin_products set stock = stock - v_qty where id = v_prod.id;
      v_list := round(v_price * v_list_pct / 100.0)::bigint;
      v_stepped := round(v_price * v_pct / 100.0)::bigint;
      v_unit := round(v_price * v_pct * (100 - v_sale) / 10000.0)::bigint;
      insert into celin_order_items (order_id, product_id, name_fa, name_en, sku, slug, image, unit_price, list_price, qty, pack)
      values (v_id, v_prod.id, v_prod.name_fa, v_prod.name_en, v_prod.sku, v_prod.slug, v_img, v_unit, v_list, v_qty, v_pack);
    end if;

    v_sub := v_sub + v_unit * v_qty;
    v_list_sub := v_list_sub + v_list * v_qty;
    v_step_sub := v_step_sub + v_stepped * v_qty;
    v_count := v_count + v_qty;
  end loop;

  -- the member confirmed the site's total: a different one here means a price, the step or the sale changed
  if p_expect is null or p_expect <> v_sub then
    raise exception 'price_changed';
  end if;

  update celin_orders
  set subtotal = v_sub,
      list_subtotal = v_list_sub,
      items_count = v_count,
      pricing = jsonb_build_object('level', p_pricing ->> 'level', 'list', v_list_pct, 'pct', v_pct, 'pieces', v_pieces)
        || case
             when v_sale > 0 then jsonb_build_object('sale', jsonb_build_object('pct', v_sale, 'fa', v_sale_fa, 'en', v_sale_en), 'stepped', v_step_sub)
             else '{}'::jsonb
           end
  where id = v_id;

  insert into celin_order_events (order_id, status, actor) values (v_id, 'pending', 'customer');
  return query select v_id, v_code;
end;
$$;

revoke all on function public.celin_place_order(uuid, jsonb, jsonb, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.celin_place_order(uuid, jsonb, jsonb, text, jsonb, bigint) to service_role;

-- the previous order function knew neither packs nor the special-day discount
drop function if exists public.celin_place_order(uuid, jsonb, jsonb, text, jsonb);

insert into public.celin_migrations (name) values ('20261128100000_celin_round_six') on conflict (name) do nothing;

-- the API sees the new columns and function at once (Supabase also does this on its own)
notify pgrst, 'reload schema';
