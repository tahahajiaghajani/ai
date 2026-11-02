-- «سیراف» migration 0013_gold_bullion — طلا: سکه‌ها و شمش‌ها
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0013_gold_bullion — طلا: سکه‌ها و شمش‌ها
-- ---------------------------------------------------------------------------
alter table tz_items add column if not exists rate_key text;
alter table tz_items add column if not exists gold_meta jsonb not null default '{}'::jsonb;
create index if not exists tz_items_rate_key_idx on tz_items (org_id, rate_key) where rate_key is not null and deleted_at is null;

alter table tz_gold_rates add column if not exists coins_buy jsonb not null default '{}'::jsonb;
alter table tz_gold_rates add column if not exists bubbles jsonb not null default '{}'::jsonb;
alter table tz_gold_rates add column if not exists meta jsonb not null default '{}'::jsonb;

alter table tz_gold_docs add column if not exists extra jsonb not null default '{}'::jsonb;
alter table tz_gold_lines add column if not exists gold_bar_id uuid;
create index if not exists tz_gold_lines_bar_idx on tz_gold_lines (org_id, gold_bar_id) where gold_bar_id is not null;

create table if not exists tz_gold_bars (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  bar_no text not null,
  item_id uuid,
  brand text,
  serial_no text,
  qr text,
  nominal_weight numeric,
  weight numeric not null default 0,
  fineness numeric not null default 995,
  fine_weight numeric not null default 0,
  weight750 numeric not null default 0,
  certificate_no text,
  certificate_issuer text,
  assay_lab text,
  assay_no text,
  assay_date date,
  seal_status text not null default 'sealed',
  source text not null default 'purchase',
  source_ref text,
  ownership text not null default 'own',
  party_id uuid,
  status text not null default 'in_stock',
  warehouse_id uuid,
  cost numeric,
  in_doc_id uuid,
  out_doc_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
-- the bar number is the shop's own barcode (renumbered on a sync clash, like tag numbers); the
-- maker's serial is unique per brand among live bars, checked by the app: a database constraint
-- would stop a Windows app's sync on a duplicate typed offline instead of reporting it
create unique index if not exists tz_gold_bars_code_uk on tz_gold_bars (org_id, bar_no) where deleted_at is null;
create index if not exists tz_gold_bars_serial_idx on tz_gold_bars (org_id, serial_no) where deleted_at is null;
create index if not exists tz_gold_bars_status_idx on tz_gold_bars (org_id, status);
create index if not exists tz_gold_bars_item_idx on tz_gold_bars (org_id, item_id);
create index if not exists tz_gold_bars_in_doc_idx on tz_gold_bars (org_id, in_doc_id);
create index if not exists tz_gold_bars_out_doc_idx on tz_gold_bars (org_id, out_doc_id);
create index if not exists tz_gold_bars_rev_idx on tz_gold_bars (org_id, rev);
drop trigger if exists tz_gold_bars_sync on tz_gold_bars;
create trigger tz_gold_bars_sync before insert or update on tz_gold_bars for each row execute function tz_sync_touch('gold_bar');
alter table tz_gold_bars enable row level security;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table tz_gold_bars from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table tz_gold_bars from authenticated;
  end if;
end
$do$;

-- a version-8 UUID derived from a seed text (same on every runtime)
create or replace function tz_seed_uuid(seed text) returns uuid language sql immutable as $fn$
  select (substr(h, 1, 12) || '8' || substr(h, 14, 3) || '8' || substr(h, 18, 15))::uuid from (select md5(seed) as h) x
$fn$;

-- account roles of bars for every business with the gold module: beside آب‌شده and the coin
-- accounts (their parents are looked up through those roles, else by code)
do $do$
declare
  o record;
  r record;
  v_parent uuid;
  v_code text;
  v_i int;
begin
  for o in select id from tz_orgs where deleted_at is null and modules ? 'gold' loop
    for r in select * from (values
      ('gold_bars', '1515', 'موجودی شمش طلا', 'asset', 'debit', 'required', 'gold_bullion'),
      ('bar_sales', '6115', 'فروش شمش', 'income', 'credit', 'none', 'coin_sales'),
      ('bar_cogs', '7114', 'بهای تمام‌شده شمش فروش‌رفته', 'expense', 'debit', 'none', 'coin_cogs')
    ) as t(key, code, name, kind, nature, weight_mode, sibling) loop
      continue when exists (select 1 from tz_accounts where org_id = o.id and system_key = r.key and deleted_at is null);
      continue when exists (select 1 from tz_accounts where id = tz_seed_uuid(o.id::text || ':account:' || r.key));
      v_parent := (select parent_id from tz_accounts where org_id = o.id and system_key = r.sibling and deleted_at is null limit 1);
      if v_parent is null then
        v_parent := (select id from tz_accounts where org_id = o.id and code = substr(r.code, 1, 2) and deleted_at is null limit 1);
      end if;
      v_code := r.code;
      v_i := 0;
      while exists (select 1 from tz_accounts where org_id = o.id and code = v_code and deleted_at is null) and v_i < 100 loop
        v_code := (v_code::int + 1)::text;
        v_i := v_i + 1;
      end loop;
      insert into tz_accounts (id, org_id, parent_id, code, name, level, kind, nature, is_postable, detail_mode, detail_kinds, fx_mode, weight_mode, system_key, sort)
      values (tz_seed_uuid(o.id::text || ':account:' || r.key), o.id, v_parent, v_code, r.name, 3, r.kind, r.nature, true, 'none', '[]'::jsonb, 'none', r.weight_mode, r.key, 500)
      on conflict (id) do nothing;
    end loop;
  end loop;
end
$do$;

-- the standard catalogue: coins made before it get their board key and metadata, the rest is added
do $do$
declare
  v_cat jsonb := $cat$[
{"key":"emami","kind":"coin","name":"سکه امامی (طرح جدید)","gold_weight":"8.13598","fineness":"900","active":true,"meta":{"family":"bank","spec":"full","pricing_mode":"board","vat_mode":"exempt","design":"emami","date_band":"86","tgju":"sekee"}},
{"key":"bahar","kind":"coin","name":"سکه بهار آزادی (طرح قدیم)","gold_weight":"8.13598","fineness":"900","active":true,"meta":{"family":"bank","spec":"full","pricing_mode":"board","vat_mode":"exempt","design":"old","tgju":"sekeb"}},
{"key":"nim","kind":"coin","name":"نیم سکه","gold_weight":"4.06799","fineness":"900","active":true,"meta":{"family":"bank","spec":"half","pricing_mode":"board","vat_mode":"exempt","date_band":"86","tgju":"nim"}},
{"key":"rob","kind":"coin","name":"ربع سکه","gold_weight":"2.033995","fineness":"900","active":true,"meta":{"family":"bank","spec":"quarter","pricing_mode":"board","vat_mode":"exempt","date_band":"86","tgju":"rob"}},
{"key":"gerami","kind":"coin","name":"سکه یک گرمی","gold_weight":"1.01","fineness":"900","active":true,"meta":{"family":"bank","spec":"gram","pricing_mode":"board","vat_mode":"exempt","packaging":"sealed","tgju":"gerami"}},
{"key":"emami_pre86","kind":"coin","name":"سکه امامی زیر ۸۶","gold_weight":"8.13598","fineness":"900","active":true,"meta":{"family":"bank","spec":"full","pricing_mode":"board","vat_mode":"exempt","design":"emami","date_band":"pre86","tgju":"sekee_down"}},
{"key":"nim_pre86","kind":"coin","name":"نیم سکه زیر ۸۶","gold_weight":"4.06799","fineness":"900","active":true,"meta":{"family":"bank","spec":"half","pricing_mode":"board","vat_mode":"exempt","date_band":"pre86","tgju":"nim_down"}},
{"key":"rob_pre86","kind":"coin","name":"ربع سکه زیر ۸۶","gold_weight":"2.033995","fineness":"900","active":true,"meta":{"family":"bank","spec":"quarter","pricing_mode":"board","vat_mode":"exempt","date_band":"pre86","tgju":"rob_down"}},
{"key":"emami_1403","kind":"coin","name":"سکه امامی ۱۴۰۳","gold_weight":"8.13598","fineness":"900","active":false,"meta":{"family":"bank","spec":"full","pricing_mode":"board","vat_mode":"exempt","design":"emami","date_band":"1403"}},
{"key":"emami_1404","kind":"coin","name":"سکه امامی ۱۴۰۴","gold_weight":"8.13598","fineness":"900","active":false,"meta":{"family":"bank","spec":"full","pricing_mode":"board","vat_mode":"exempt","design":"emami","date_band":"1404"}},
{"key":"nim_1404","kind":"coin","name":"نیم سکه ۱۴۰۴","gold_weight":"4.06799","fineness":"900","active":false,"meta":{"family":"bank","spec":"half","pricing_mode":"board","vat_mode":"exempt","date_band":"1404"}},
{"key":"rob_1404","kind":"coin","name":"ربع سکه ۱۴۰۴","gold_weight":"2.033995","fineness":"900","active":false,"meta":{"family":"bank","spec":"quarter","pricing_mode":"board","vat_mode":"exempt","date_band":"1404"}},
{"key":"gerami_loose","kind":"coin","name":"سکه یک گرمی بدون بسته‌بندی","gold_weight":"1.01","fineness":"900","active":false,"meta":{"family":"bank","spec":"gram","pricing_mode":"board","vat_mode":"exempt","packaging":"loose"}},
{"key":"two_half","kind":"coin","name":"دو و نیم سکه بهار آزادی","gold_weight":"20.33995","fineness":"900","active":false,"meta":{"family":"bank","spec":"two_half","pricing_mode":"board","vat_mode":"exempt"}},
{"key":"five","kind":"coin","name":"پنج سکه بهار آزادی","gold_weight":"40.6799","fineness":"900","active":false,"meta":{"family":"bank","spec":"five","pricing_mode":"board","vat_mode":"exempt"}},
{"key":"parsian_50","kind":"coin","name":"سکه پارسیان ۵۰ سوت","gold_weight":"0.05","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":50,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_100","kind":"coin","name":"سکه پارسیان ۱۰۰ سوت","gold_weight":"0.1","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":100,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_150","kind":"coin","name":"سکه پارسیان ۱۵۰ سوت","gold_weight":"0.15","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":150,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_200","kind":"coin","name":"سکه پارسیان ۲۰۰ سوت","gold_weight":"0.2","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":200,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_250","kind":"coin","name":"سکه پارسیان ۲۵۰ سوت","gold_weight":"0.25","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":250,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_300","kind":"coin","name":"سکه پارسیان ۳۰۰ سوت","gold_weight":"0.3","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":300,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_400","kind":"coin","name":"سکه پارسیان ۴۰۰ سوت","gold_weight":"0.4","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":400,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_500","kind":"coin","name":"سکه پارسیان ۵۰۰ سوت","gold_weight":"0.5","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":500,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_600","kind":"coin","name":"سکه پارسیان ۶۰۰ سوت","gold_weight":"0.6","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":600,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_700","kind":"coin","name":"سکه پارسیان ۷۰۰ سوت","gold_weight":"0.7","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":700,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_800","kind":"coin","name":"سکه پارسیان ۸۰۰ سوت","gold_weight":"0.8","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":800,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_900","kind":"coin","name":"سکه پارسیان ۹۰۰ سوت","gold_weight":"0.9","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":900,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"4","packaging":"sealed"}},
{"key":"parsian_1000","kind":"coin","name":"سکه پارسیان ۱ گرمی","gold_weight":"1","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":1000,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_1100","kind":"coin","name":"سکه پارسیان ۱٫۱ گرمی","gold_weight":"1.1","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":1100,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_1200","kind":"coin","name":"سکه پارسیان ۱٫۲ گرمی","gold_weight":"1.2","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":1200,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_1300","kind":"coin","name":"سکه پارسیان ۱٫۳ گرمی","gold_weight":"1.3","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":1300,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_1500","kind":"coin","name":"سکه پارسیان ۱٫۵ گرمی","gold_weight":"1.5","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":1500,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_1600","kind":"coin","name":"سکه پارسیان ۱٫۶ گرمی","gold_weight":"1.6","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":1600,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_1800","kind":"coin","name":"سکه پارسیان ۱٫۸ گرمی","gold_weight":"1.8","fineness":"750","active":false,"meta":{"family":"parsian","spec":"parsian","sut":1800,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"parsian_2000","kind":"coin","name":"سکه پارسیان ۲ گرمی","gold_weight":"2","fineness":"750","active":true,"meta":{"family":"parsian","spec":"parsian","sut":2000,"pricing_mode":"weight","vat_mode":"wage_profit","wage_type":"percent","wage_value":"3","packaging":"sealed"}},
{"key":"pahlavi_1","kind":"coin","name":"یک پهلوی","gold_weight":"8.136","fineness":"900","active":false,"meta":{"family":"foreign","spec":"pahlavi","pricing_mode":"weight","vat_mode":"exempt","wage_type":"fixed","wage_value":"0"}},
{"key":"pahlavi_half","kind":"coin","name":"نیم پهلوی","gold_weight":"4.068","fineness":"900","active":false,"meta":{"family":"foreign","spec":"pahlavi_half","pricing_mode":"weight","vat_mode":"exempt","wage_type":"fixed","wage_value":"0"}},
{"key":"pahlavi_quarter","kind":"coin","name":"ربع پهلوی","gold_weight":"2.034","fineness":"900","active":false,"meta":{"family":"foreign","spec":"pahlavi_quarter","pricing_mode":"weight","vat_mode":"exempt","wage_type":"fixed","wage_value":"0"}},
{"key":"sovereign","kind":"coin","name":"لیره (ساورین)","gold_weight":"7.98805","fineness":"916.7","active":false,"meta":{"family":"foreign","spec":"sovereign","pricing_mode":"weight","vat_mode":"exempt","wage_type":"fixed","wage_value":"0"}},
{"key":"bar_1","kind":"bar","name":"شمش ۱ گرمی ۹۹۹٫۹","gold_weight":"1","fineness":"999.9","active":true,"meta":{"family":"bar","bar_type":"minted","pricing_mode":"weight","vat_mode":"exempt","packaging":"sealed"}},
{"key":"bar_2_5","kind":"bar","name":"شمش ۲٫۵ گرمی ۹۹۹٫۹","gold_weight":"2.5","fineness":"999.9","active":true,"meta":{"family":"bar","bar_type":"minted","pricing_mode":"weight","vat_mode":"exempt","packaging":"sealed"}},
{"key":"bar_5","kind":"bar","name":"شمش ۵ گرمی ۹۹۹٫۹","gold_weight":"5","fineness":"999.9","active":true,"meta":{"family":"bar","bar_type":"minted","pricing_mode":"weight","vat_mode":"exempt","packaging":"sealed"}},
{"key":"bar_10","kind":"bar","name":"شمش ۱۰ گرمی ۹۹۹٫۹","gold_weight":"10","fineness":"999.9","active":true,"meta":{"family":"bar","bar_type":"minted","pricing_mode":"weight","vat_mode":"exempt","packaging":"sealed"}},
{"key":"bar_20","kind":"bar","name":"شمش ۲۰ گرمی ۹۹۵","gold_weight":"20","fineness":"995","active":true,"meta":{"family":"bar","bar_type":"minted","pricing_mode":"weight","vat_mode":"exempt","packaging":"sealed"}},
{"key":"bar_50","kind":"bar","name":"شمش ۵۰ گرمی ۹۹۵","gold_weight":"50","fineness":"995","active":false,"meta":{"family":"bar","bar_type":"cast","pricing_mode":"weight","vat_mode":"exempt"}},
{"key":"bar_100","kind":"bar","name":"شمش ۱۰۰ گرمی ۹۹۵","gold_weight":"100","fineness":"995","active":true,"meta":{"family":"bar","bar_type":"cast","pricing_mode":"weight","vat_mode":"exempt"}},
{"key":"bar_kilo","kind":"bar","name":"شمش یک کیلویی ۹۹۵","gold_weight":"1000","fineness":"995","active":true,"meta":{"family":"bar","bar_type":"kilo","pricing_mode":"weight","vat_mode":"exempt"}},
{"key":"bar_other","kind":"bar","name":"شمش (وزن آزاد)","gold_weight":null,"fineness":"995","active":true,"meta":{"family":"bar","bar_type":"other","pricing_mode":"weight","vat_mode":"exempt"}}
]$cat$::jsonb;
  o record;
  it record;
  e record;
  v_key text;
  v_entry jsonb;
  v_unit uuid;
  v_id uuid;
  v_code text;
  v_n int;
begin
  for o in select id from tz_orgs where deleted_at is null and modules ? 'gold' loop
    v_unit := (select id from tz_units where org_id = o.id and name = 'عدد' and deleted_at is null order by created_at limit 1);
    for it in
      select id, name, sku from tz_items
      where org_id = o.id and kind = 'coin' and rate_key is null and deleted_at is null
      order by length(code), code, id
    loop
      if lower(trim(coalesce(it.sku, ''))) in ('emami', 'bahar', 'nim', 'rob', 'gerami') then
        v_key := lower(trim(it.sku));
      else
        v_key := case
          when it.name like '%پارسیان%' or it.name like '%پهلوی%' then null
          when it.name like '%نیم%' then 'nim'
          when it.name like '%ربع%' then 'rob'
          when it.name like '%گرمی%' then 'gerami'
          when it.name like '%امامی%' then 'emami'
          when it.name like '%بهار%' then 'bahar'
          else null
        end;
        if v_key in ('nim', 'rob', 'emami') and (it.name like '%زیر ۸۶%' or it.name like '%زیر 86%' or it.name like '%قبل ۸۶%' or it.name like '%قبل 86%' or it.name like '%قبل از ۸۶%' or it.name like '%قبل از 86%') then
          v_key := v_key || '_pre86';
        end if;
      end if;
      continue when v_key is null;
      continue when exists (select 1 from tz_items where org_id = o.id and rate_key = v_key and deleted_at is null);
      v_entry := (select x from jsonb_array_elements(v_cat) x where x->>'key' = v_key limit 1);
      update tz_items set
        rate_key = v_key,
        gold_meta = coalesce(v_entry->'meta', '{}'::jsonb),
        gold_weight = case when gold_weight in (8.133, 4.066, 2.033) and v_entry->>'gold_weight' is not null then (v_entry->>'gold_weight')::numeric else gold_weight end,
        fineness = coalesce(fineness, (v_entry->>'fineness')::numeric)
      where id = it.id;
    end loop;
    for e in select x as v from jsonb_array_elements(v_cat) with ordinality as a(x, n) order by n loop
      v_key := e.v->>'key';
      continue when exists (select 1 from tz_items where org_id = o.id and rate_key = v_key and deleted_at is null);
      v_id := tz_seed_uuid(o.id::text || ':gold:' || v_key);
      continue when exists (select 1 from tz_items where id = v_id);
      v_n := 1;
      loop
        v_code := (case when e.v->>'kind' = 'bar' then 'B' else 'C' end) || v_n;
        exit when not exists (select 1 from tz_items where org_id = o.id and code = v_code and deleted_at is null);
        v_n := v_n + 1;
      end loop;
      insert into tz_items (id, org_id, code, name, kind, unit_id, gold_weight, fineness, vat_pct, is_active, rate_key, gold_meta)
      values (v_id, o.id, v_code, e.v->>'name', e.v->>'kind', v_unit, (e.v->>'gold_weight')::numeric, (e.v->>'fineness')::numeric, 0,
              (e.v->>'active')::boolean, v_key, e.v->'meta');
    end loop;
  end loop;
end
$do$;

insert into tz_migrations (id) values ('0013_gold_bullion') on conflict (id) do nothing;
