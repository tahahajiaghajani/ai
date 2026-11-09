// The security module in the AI index and the access model:
//   · security incidents and policies are RAG sources whose AI channel holds only for records classified at or below
//     the organisation's AI ceiling (never «سری»): retrieval and every skill skip the others; policies answer only
//     when published (drafts never reach an answer); controls, issues and compliance evidence follow their tables'
//     `ai` declarations and their area's access
//   · the audience of a running policy campaign reads that campaign and its published policy (a participant grant:
//     single-record reads, notifications and the acknowledgement page — never a list of the compliance area)
import type { TableDef } from "@shared/model/types";
import { registerAiChannel, registerRagSource, defaultDocument } from "../ai/rag";
import { registerParticipantSource } from "../../access";

const rank = (expr: string) => `(case coalesce(${expr}, 'internal') when 'public' then 0 when 'internal' then 1 when 'confidential' then 2 else 3 end)`;

/** The organisation's AI ceiling as a rank (default «محرمانه»; «سری» is never allowed). */
const ceiling = (t: string) =>
  `(case coalesce((select c.ai_max_classification from sm_sec_configs c where c.org_id = ${t}.org_id and c.deleted_at is null order by c.created_at limit 1), 'confidential') when 'public' then 0 when 'internal' then 1 else 2 end)`;

/** The record's classification is at or below the organisation's AI ceiling. */
const withinCeiling = (t: string) => `${rank(`${t}.classification`)} <= ${ceiling(t)}`;

/** A running campaign addresses the user (alias `c`): everyone, the named people, members of its groups or people of its units. */
function audienceSql(c: string, u: string, ut: string): string {
  return `(${c}.state = 'active' and ${c}.deleted_at is null and (${c}.target_all
    or coalesce(${c}.target_users ? ${ut}, false)
    or exists (select 1 from sm_group_members gm where gm.org_id = ${c}.org_id and gm.deleted_at is null and gm.user_id = ${u}
      and gm.kind in ('member', 'lead') and (gm.valid_from is null or gm.valid_from <= now()) and (gm.valid_to is null or gm.valid_to > now())
      and coalesce(${c}.target_groups ? gm.group_id::text, false))
    or exists (select 1 from sm_member_profiles mp join sm_org_units ou on ou.id = mp.org_unit_id and ou.org_id = mp.org_id
      where mp.org_id = ${c}.org_id and mp.deleted_at is null and mp.user_id = ${u}
      and exists (select 1 from jsonb_array_elements_text(coalesce(${c}.target_units, '[]'::jsonb)) tu(id) where ou.path like ('%/' || tu.id || '/%')))))`;
}

let installed = false;

export function installSecurityRag(): void {
  if (installed) return;
  installed = true;
  registerRagSource({
    table: "sec_incident",
    version: "s1",
    async build({ def, row }) {
      return defaultDocument(def, row);
    },
    aiWhere: (t) => withinCeiling(t),
  });
  registerRagSource({
    table: "grc_policy",
    version: "p1",
    async build({ def, row }) {
      if (row.state !== "published") return null;
      return defaultDocument(def, row);
    },
    aiWhere: (t) => `${t}.state = 'published' and ${withinCeiling(t)}`,
    aiChannel: (t) => withinCeiling(t),
  });
  // evidence has no classification of its own: it is always confidential
  registerAiChannel("sec_evidence", (t) => `2 <= ${ceiling(t)}`);

  registerParticipantSource({
    name: "policy_campaign_audience",
    reach: "grant",
    sql(def: TableDef, alias: string, params: unknown[], userId: string) {
      if (def.key !== "grc_policy_campaign" && def.key !== "grc_policy") return null;
      params.push(userId);
      const u = `$${params.length}::uuid`;
      params.push(userId);
      const ut = `$${params.length}::text`;
      if (def.key === "grc_policy_campaign") return audienceSql(alias, u, ut);
      return `(${alias}.state = 'published' and exists (select 1 from sm_grc_policy_campaigns pc where pc.org_id = ${alias}.org_id and pc.policy_id = ${alias}.id and ${audienceSql("pc", u, ut)}))`;
    },
    async tables(q, orgId) {
      const r = await q.one<{ ok: number }>(`select 1 as ok from sm_grc_policy_campaigns where org_id = $1 and state = 'active' and deleted_at is null limit 1`, [orgId]);
      return r ? ["grc_policy_campaign", "grc_policy"] : [];
    },
  });
}
