-- The owner's rule: never name the stone material (no «کیوبیک زیرکونیا» / «زیرکونیای مکعبی» / cubic zirconia).
-- Product specs imported from the starter catalogue carry it ("نگین: زیرکونیای مکعبی سفید با تراش اتمی").
-- Idempotent: only rows that still mention it are touched; spec order is kept.
update celin_products
set specs = (
  select coalesce(jsonb_agg(
    case when s ? 'value_fa' then
      jsonb_set(
        jsonb_set(s, '{value_fa}', to_jsonb(btrim(regexp_replace(s->>'value_fa', '(کیوبیک\s*)?زیرکونیا(ی\s*مکعبی)?\s*', '', 'g')))),
        '{value_en}', to_jsonb(btrim(regexp_replace(regexp_replace(coalesce(s->>'value_en', ''), 'round-cut cubic zirconia and', 'round cut, with', 'gi'), '\s*cubic zirconia', '', 'gi'))))
    else s end order by o), '[]'::jsonb)
  from jsonb_array_elements(specs) with ordinality as e(s, o))
where specs::text ~* 'زیرکونیا|zirconia';
