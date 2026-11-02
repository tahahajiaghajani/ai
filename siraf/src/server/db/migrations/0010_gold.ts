// Gold & jewellery module, part 2 (idempotent): extra columns on document lines and the
// indexes the counter screen, piece bookkeeping and the weight reports need.
//
// tz_gold_lines (children of the gold_doc aggregate, synced with it):
// - cost    the rial cost moved by the line (cost of goods sold, inventory value received)
// - tag_no  tag number of the piece (kept on the line so a re-posted purchase keeps its tags)
// - extra   piece attributes for tags created by the document (sale wage, stone description…)
export default /* sql */ `
alter table tz_gold_lines add column if not exists cost numeric;
alter table tz_gold_lines add column if not exists tag_no text;
alter table tz_gold_lines add column if not exists extra jsonb not null default '{}'::jsonb;

create index if not exists tz_gold_lines_item_idx on tz_gold_lines (org_id, gold_item_id);
create index if not exists tz_gold_docs_kind_idx on tz_gold_docs (org_id, kind, date);
create index if not exists tz_gold_items_in_doc_idx on tz_gold_items (org_id, in_doc_id);
create index if not exists tz_gold_items_out_doc_idx on tz_gold_items (org_id, out_doc_id);
create index if not exists tz_gold_items_category_idx on tz_gold_items (org_id, category_id, status);
`;
