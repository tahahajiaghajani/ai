// Identification at scale (design A §8.5): the reconciliation engine (src/server/modules/cmdb/ire.ts `matchEntry`)
// compares CIs' identity columns through expressions — serials, asset tags and BIOS UUIDs with their digits made Latin,
// spaces dropped and upper case; host names, FQDNs and MAC addresses in lower case; names normalised as the search box
// does — which the plain (org_id, column) indexes of the generated DDL cannot serve: every identification scanned the
// organisation's CIs. These indexes hold exactly those expressions, over live CIs that are not merged (what
// identification reads), so an identification is an index lookup however large the CMDB grows.
//
// The expressions must stay the IRE's text exactly (the planner matches the expression, constants included):
// tests/discovery-logic.test.ts holds them equal, and tests/discovery-pg.test.ts proves on a real PostgreSQL that the
// IRE's own queries use them. A change to the IRE's expressions needs a new migration with new indexes.
const DIGITS_FROM = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
const DIGITS_TO = "01234567890123456789";
/** @shared/model/conditions SEARCH_FROM / SEARCH_TO (engine/sql.ts `normSql`): upper-case Latin, Persian and Arabic digits, Arabic yeh and kaf, and the zero-width marks */
const NAME_FROM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏";
const NAME_TO = "abcdefghijklmnopqrstuvwxyz01234567890123456789ییک";

const ident = (col: string) => `upper(replace(translate(${col}, '${DIGITS_FROM}', '${DIGITS_TO}'), ' ', ''))`;
const live = "where deleted_at is null and merged_into is null";

/** The indexed expressions, by CI column (exported for the test that holds them equal to the IRE's). */
export const IDENTITY_INDEX_EXPRESSIONS: Record<string, string> = {
  serial_number: ident("serial_number"),
  asset_tag: ident("asset_tag"),
  bios_uuid: ident("bios_uuid"),
  hostname: "lower(hostname)",
  fqdn: "lower(fqdn)",
  mac_address: "lower(mac_address)",
  name: `lower(translate(name, '${NAME_FROM}', '${NAME_TO}'))`,
};

export default /* sql */ `
create index if not exists sm_cis_ident_serial_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.serial_number})) ${live};
create index if not exists sm_cis_ident_tag_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.asset_tag})) ${live};
create index if not exists sm_cis_ident_bios_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.bios_uuid})) ${live};
create index if not exists sm_cis_ident_host_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.hostname})) ${live};
create index if not exists sm_cis_ident_fqdn_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.fqdn})) ${live};
create index if not exists sm_cis_ident_mac_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.mac_address})) ${live};
create index if not exists sm_cis_ident_name_idx on sm_cis (org_id, (${IDENTITY_INDEX_EXPRESSIONS.name})) ${live};
`;
