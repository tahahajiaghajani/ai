// Service roles in context (catalogue SPF-008): a service names its owner, product owner, owner team, support group,
// change approvers and stakeholder groups. Two of those roles reach beyond the service record without a global role:
//   · the owner and the product owner read every record linked to their service — the `service_id` or the affected
//     services of incidents, problems, changes, requests… (an access-model participant source of reach «grant»: read
//     only, never write, also without a role in the record's area; domains, confidentiality and field groups hold;
//     bounded — a record in a secure workspace or a restricted group stays with that workspace's or group's members).
//     Only portfolio managers name themselves owner or product owner of a service that exists (hooks.ts).
//   · approval rules name «مالک خدمت» (`{ kind: "owner", of: "service_owner" }`) and «تأییدکنندگان تغییر خدمت»
//     (`of: "service_change_approvers"`): the owners, or the members of the change-approval group, of the services a
//     record names (its service, its offering's service, its affected services)
import type { TableDef } from "@shared/model/types";
import { physicalTables } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { registerParticipantSource } from "../../access";
import { registerApproverSource } from "../sla";
import { groupMembers } from "../notify/recipients";
import { isUuid, liveRow, liveRows, sysOf, type Row } from "./common";

/** The service fields of a table that link its records to services (never the portfolio's own tables). */
function serviceLinks(def: TableDef): { single: string[]; multi: string[] } {
  if (def.virtual || def.module === "service_portfolio") return { single: [], multi: [] };
  const single = def.fields.filter((f) => f.type === "ref" && f.ref === "service" && f.name === "service_id").map((f) => f.name);
  const multi = def.fields.filter((f) => f.type === "refs" && f.ref === "service" && f.name === "affected_services").map((f) => f.name);
  return { single, multi };
}

/** The services a record names: its service, its offering's service, its affected and impacted services. */
export async function servicesOfRecord(q: Queryable, ctx: Ctx, row: Row): Promise<Row[]> {
  const ids = new Set<string>();
  if (isUuid(row.service_id)) ids.add(row.service_id);
  // affected services, and those a change's CIs reach (computed from the CMDB)
  for (const s of [...(Array.isArray(row.affected_services) ? row.affected_services : []), ...(Array.isArray(row.impacted_services) ? row.impacted_services : [])]) if (isUuid(s)) ids.add(s);
  if (isUuid(row.offering_id)) {
    const o = await liveRow(q, sysOf(ctx), "service_offering", row.offering_id);
    if (isUuid(o?.service_id)) ids.add(o!.service_id);
  }
  if (!ids.size) return [];
  return liveRows(q, sysOf(ctx), "service", { f: "id", op: "in", v: [...ids] }, { limit: 50 });
}

export function installServiceRoles(): (() => void)[] {
  return [
    // a read grant of its own (docs/spec/ACCESS.md §7): owners read the linked records without a role in their areas
    registerParticipantSource({
      name: "service_owners",
      // a role in context the linked record does not name: never past its secure workspace or restricted group
      bounded: true,
      reach: "grant",
      async tables(q, orgId, userId) {
        const owns = await q.one(`select 1 from sm_services where org_id = $1 and deleted_at is null and (owner_id = $2::uuid or product_owner_id = $2::uuid) limit 1`, [orgId, userId]);
        if (!owns) return [];
        return physicalTables().filter((d) => {
          const l = serviceLinks(d);
          return l.single.length > 0 || l.multi.length > 0;
        }).map((d) => d.key);
      },
      sql(def, alias, params, userId) {
        const { single, multi } = serviceLinks(def);
        if (!single.length && !multi.length) return null;
        params.push(userId);
        const u = `$${params.length}::uuid`;
        const owned = `select s.id from sm_services s where s.org_id = ${alias}.org_id and s.deleted_at is null and (s.owner_id = ${u} or s.product_owner_id = ${u})`;
        const terms = [
          ...single.map((f) => `${alias}.${f} in (${owned})`),
          ...multi.map((f) => `exists (select 1 from sm_services s where s.org_id = ${alias}.org_id and s.deleted_at is null and (s.owner_id = ${u} or s.product_owner_id = ${u}) and coalesce(${alias}.${f} ? s.id::text, false))`),
        ];
        return terms.join(" or ");
      },
    }),
    registerApproverSource("service_owner", async (q, ctx, _def, row) => {
      const services = await servicesOfRecord(q, ctx, row);
      return [...new Set(services.map((s) => s.owner_id).filter(isUuid))];
    }),
    registerApproverSource("service_change_approvers", async (q, ctx, _def, row) => {
      const services = await servicesOfRecord(q, ctx, row);
      const groups = services.map((s) => s.change_approval_group_id).filter(isUuid);
      const people = groups.length ? await groupMembers(sysOf(ctx), groups, q) : [];
      return [...new Set(people.length ? people : services.map((s) => s.owner_id).filter(isUuid))];
    }),
  ];
}
