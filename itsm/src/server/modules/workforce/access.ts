// Who reads workforce rows without a role in the area (docs/spec/ACCESS.md §6–7, participant sources of reach
// «grant»): built-in roles give agents nothing in `workforce`, yet every person must see their own skills,
// certifications, time off, presence and points, and their team's rosters, capacity and skill needs. The module's
// participant source names exactly those rows — the person in the row's own field, or a valid member or lead of the
// row's group — and the reference data (the skills catalogue and the shift patterns) for every member. It only ever
// reads: people change their own rows through the module's routes, managers through the area's grants (the module's
// seeded roles «مدیر نیروی کار» and «سرپرست تیم (نیروی کار)»).
import type { TableDef } from "@shared/model/types";
import { registerParticipantSource } from "../../access/predicate";

/** Reference tables every member reads. */
export const WFM_PUBLIC = ["wfm_skill", "wfm_shift_pattern"];
/** Tables whose rows belong to the person in `user_id`. */
export const WFM_PERSONAL = ["wfm_person_skill", "wfm_certification", "wfm_absence", "wfm_agent", "wfm_presence_log", "wfm_points"];
/** Tables whose rows belong to a team (`group_id`); rosters also to their person. */
export const WFM_TEAM = ["wfm_roster", "wfm_capacity", "wfm_coverage"];

function teamMember(alias: string, me: string): string {
  return `exists (select 1 from sm_group_members gm where gm.org_id = ${alias}.org_id and gm.group_id = ${alias}.group_id and gm.user_id = ${me}
    and gm.deleted_at is null and gm.kind in ('member', 'lead') and (gm.valid_from is null or gm.valid_from <= now()) and (gm.valid_to is null or gm.valid_to > now()))`;
}

let installed = false;

export function installWorkforceAccess(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return [
    registerParticipantSource({
      name: "workforce.self_and_team",
      reach: "grant",
      sql(def: TableDef, alias: string, params: unknown[], userId: string): string | null {
        if (WFM_PUBLIC.includes(def.key)) return "true";
        const personal = WFM_PERSONAL.includes(def.key);
        const team = WFM_TEAM.includes(def.key);
        const kudos = def.key === "wfm_kudos";
        if (!personal && !team && !kudos) return null;
        params.push(userId);
        const me = `$${params.length}::uuid`;
        if (kudos) return `(${alias}.to_id = ${me} or ${alias}.from_id = ${me})`;
        if (personal) return `${alias}.user_id = ${me}`;
        const own = def.key === "wfm_roster" ? `${alias}.user_id = ${me} or ` : "";
        return `(${own}${teamMember(alias, me)})`;
      },
    }),
  ];
}
