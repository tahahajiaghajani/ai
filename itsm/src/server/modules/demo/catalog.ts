// The demo load's and purge's reads of the database's own tables and columns, over pg_catalog. Until 1.1.5 they read
// information_schema, whose views work out every column's text — its type named, its privileges checked, its default
// deparsed by pg_get_expr, which opens the column's table and so waits while any of them is locked against readers (an
// ACCESS EXCLUSIVE lock held or queued): on CI's PostgreSQL the web version's load had its read of every column
// canceled at the 30 s limit again and again, and the pack ended «failed». These read the catalogs alone (no table
// opened, no lock waited for) and give information_schema's answer: the same rows and values in its order, privileges
// included (tests/demo-catalog.test.ts compares them on PGlite and PostgreSQL).

/** information_schema.columns shows a column to its table's owner (or a member of that role) and to holders of a column privilege. */
const SEES_COLUMN = (rel: string, att: string) =>
  `(pg_has_role(${rel}.relowner, 'USAGE') or has_column_privilege(${rel}.oid, ${att}.attnum, 'SELECT, INSERT, UPDATE, REFERENCES'))`;

/**
 * Every column of the current schema's tables named `sm_*` (information_schema.columns joined with its tables of type
 * 'BASE TABLE': relkind r or p, outside this session's temporary schema): `t` table_name, `c` column_name, `n`
 * ordinal_position, `dt` data_type (a domain's base type, 'ARRAY', 'USER-DEFINED'), `nul` is_nullable ('YES'/'NO'),
 * `def` column_default is not null (a generated column has none), `gen` is_generated ('ALWAYS'/'NEVER').
 */
const SM_COLUMNS = `(select r.relname as t, a.attname as c, a.attnum as n,
         case when ty.typtype = 'd' then
                case when bt.typelem <> 0 and bt.typlen = -1 then 'ARRAY'
                     when bt.typnamespace = 'pg_catalog'::regnamespace then format_type(ty.typbasetype, null)
                     else 'USER-DEFINED' end
              when ty.typelem <> 0 and ty.typlen = -1 then 'ARRAY'
              when ty.typnamespace = 'pg_catalog'::regnamespace then format_type(a.atttypid, null)
              else 'USER-DEFINED' end as dt,
         case when a.attnotnull or (ty.typtype = 'd' and ty.typnotnull) then 'NO' else 'YES' end as nul,
         a.attgenerated = '' and ad.adbin is not null as def,
         case when a.attgenerated <> '' then 'ALWAYS' else 'NEVER' end as gen
    from pg_attribute a
    join pg_class r on r.oid = a.attrelid
    join pg_namespace s on s.oid = r.relnamespace
    join pg_type ty on ty.oid = a.atttypid
    left join pg_type bt on ty.typtype = 'd' and bt.oid = ty.typbasetype
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
   where s.nspname = current_schema() and s.oid <> pg_my_temp_schema() and r.relkind in ('r', 'p') and r.relname like 'sm\\_%'
     and a.attnum > 0 and not a.attisdropped and ${SEES_COLUMN("r", "a")})`;

/** The physical tables' columns in table and column order (purge.ts `tablesInfo`). */
export const TABLE_COLUMNS = `select x.t, x.c, x.dt, x.nul, x.def, x.gen from ${SM_COLUMNS} x order by x.t, x.n`;

/** The tables with an `org_id` column, by name, and whether they have `id` and `deleted_at` (verify.ts `danglingRefs`). */
export const ORG_TABLES = `select x.t, bool_or(x.c = 'id') as has_id, bool_or(x.c = 'deleted_at') as has_deleted
  from ${SM_COLUMNS} x group by x.t having bool_or(x.c = 'org_id') order by 1`;

/**
 * SQL: has the current schema's table, view or foreign table that the expression `table` names a column `column`
 * (information_schema.columns: `table_schema = current_schema() and table_name = <table> and column_name = <column>`)?
 */
export const hasColumn = (table: string, column: string): string =>
  `exists (select 1 from pg_attribute catt join pg_class crel on crel.oid = catt.attrelid join pg_namespace cnsp on cnsp.oid = crel.relnamespace
     where cnsp.nspname = current_schema() and crel.relname = ${table} and crel.relkind in ('r', 'v', 'f', 'p')
       and catt.attname = '${column.replace(/'/g, "''")}' and catt.attnum > 0 and not catt.attisdropped and ${SEES_COLUMN("crel", "catt")})`;

/**
 * SQL: is there a table, view or foreign table of the current schema that the expression `table` names, one the
 * caller may see (information_schema.tables: `table_schema = current_schema() and table_name = <table>`)?
 */
export const hasTable = (table: string): string =>
  `exists (select 1 from pg_class crel join pg_namespace cnsp on cnsp.oid = crel.relnamespace
     where cnsp.nspname = current_schema() and crel.relname = ${table} and crel.relkind in ('r', 'v', 'f', 'p')
       and (pg_has_role(crel.relowner, 'USAGE') or has_table_privilege(crel.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            or has_any_column_privilege(crel.oid, 'SELECT, INSERT, UPDATE, REFERENCES')))`;
