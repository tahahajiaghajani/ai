// Who reads a case without a grant in `process` (design F §6.2, package F4b): two participant sources of reach
// `grant` — they open exactly the cases that name the person, never an area:
//   · `process` — the requester (`requested_by`, `requested_for`) and the participants the authority keeps on the case
//     (the people of its open tasks and those who acted; a candidate whose task closed as «دیگر لازم نیست» drops out,
//     so they stop reading it and their Windows app receives a tombstone with the next pull);
//   · `process_managers` (bounded: never past a secure workspace or a restricted group) — the process managers named on
//     the case (`managers`), or a valid membership of one of its `manager_groups`; a publish pushes both to every case.
// The table's own row rule (`rowAccess.read`, @shared/tables/process) then closes a confidential case to everyone but
// these people, area grants included. Designers and publishers hold `process_design`, never `process`: they read no
// case. Each source answers «does this person take part in any case» with one indexed query per request (`tables`),
// so lists of people who take part in none stay index lookups.
import type { TableDef } from "@shared/model/types";
import type { Queryable } from "../../../db";
import { registerParticipantSource } from "../../../access";

const CASE = "process_case";

/** The person in SQL: a uuid parameter and the same id as a text parameter (jsonb `?` takes text). */
interface Me {
  u: string;
  t: string;
}

/** The groups the person (a uuid in SQL) is a valid member of now (any kind, active groups), as text for jsonb `?|`. */
export const myGroupsSql = (u: string) =>
  `array(select gm.group_id::text from sm_group_members gm join sm_groups g on g.id = gm.group_id and g.deleted_at is null and g.active is not false
    where gm.user_id = ${u} and gm.deleted_at is null and (gm.valid_from is null or gm.valid_from <= now()) and (gm.valid_to is null or gm.valid_to > now()))`;

/** The requester or a participant of the case aliased `alias` is the person. */
const takesPart = (alias: string, me: Me) => `(${alias}.requested_by = ${me.u} or ${alias}.requested_for = ${me.u} or ${alias}.participants ? ${me.t})`;

/** The managers of the case aliased `alias` name the person, by name or through a group they belong to. */
const manages = (alias: string, me: Me) => `(${alias}.managers ? ${me.t} or ${alias}.manager_groups ?| ${myGroupsSql(me.u)})`;

function person(params: unknown[], userId: string): Me {
  params.push(userId);
  const u = `$${params.length}::uuid`;
  params.push(userId);
  return { u, t: `$${params.length}::text` };
}

async function anyCase(q: Queryable, orgId: string, userId: string, term: (alias: string, me: Me) => string): Promise<string[]> {
  const hit = await q.one(`select 1 as x from sm_process_cases c where c.org_id = $1 and c.deleted_at is null and ${term("c", { u: "$2::uuid", t: "$3::text" })} limit 1`, [orgId, userId, userId]);
  return hit ? [CASE] : [];
}

let installed = false;

/** Register the two participant sources of cases (idempotent; returns the unregister functions). */
export function installCaseSources(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return [
    registerParticipantSource({
      name: "process",
      reach: "grant",
      sql: (def: TableDef, alias: string, params: unknown[], userId: string) => (def.key === CASE ? takesPart(alias, person(params, userId)) : null),
      tables: (q, orgId, userId) => anyCase(q, orgId, userId, takesPart),
    }),
    registerParticipantSource({
      name: "process_managers",
      reach: "grant",
      bounded: true,
      sql: (def: TableDef, alias: string, params: unknown[], userId: string) => (def.key === CASE ? manages(alias, person(params, userId)) : null),
      tables: (q, orgId, userId) => anyCase(q, orgId, userId, manages),
    }),
  ];
}
