// «مدیریت سامانه» ← هوش مصنوعی: AI status and usage of every organisation (platform metadata only — never keys,
// prompts or conversations) and the platform policy.
import type { ServerConfig } from "../../context";
import type { AiAdminOrg, AiAdminOverview } from "@shared/ai/api";
import type { AiErrorKind } from "@shared/ai/types";
import { fromJalali, toJalali, todayISO } from "@shared/jalali";
import { D } from "@shared/money";
import { disabledByPlatform, loadPolicy, normalizeSettings } from "./settings";

interface OrgAgg {
  id: string;
  name: string;
  settings: unknown;
  ai_disabled: boolean | null;
  connections: number;
  presets: string[] | null;
  ok: number;
  errors: number;
  last_error: { kind: AiErrorKind; at: string } | null;
  cost: string | null;
  calls: number | null;
  failed: number | null;
  users: number | null;
  last_used_at: string | null;
}

export async function adminOverview(cfg: ServerConfig): Promise<AiAdminOverview> {
  const policy = await loadPolicy(cfg);
  const j = toJalali(todayISO());
  const monthStart = fromJalali(j.jy, j.jm, 1);
  const rows = await cfg.db.query<OrgAgg>(
    `select o.id, o.name, s.settings, oa.ai_disabled,
       coalesce(c.n, 0)::int as connections, c.presets, coalesce(c.ok, 0)::int as ok, coalesce(c.errors, 0)::int as errors, c.last_error,
       u.cost, u.calls, u.failed, u.users, u.last_used_at
     from sm_orgs o
     left join sm_ai_settings s on s.org_id = o.id
     left join sm_org_admin oa on oa.org_id = o.id
     left join lateral (
       select count(*) as n, array_agg(distinct preset) as presets,
              count(*) filter (where status = 'ok') as ok, count(*) filter (where status = 'error') as errors,
              (select jsonb_build_object('kind', x.last_error->>'kind', 'at', x.last_error->>'at') from sm_ai_connections x
                where x.org_id = o.id and x.deleted_at is null and x.status = 'error' and x.last_error is not null order by x.checked_at desc nulls last limit 1) as last_error
       from sm_ai_connections where org_id = o.id and deleted_at is null
     ) c on true
     left join lateral (
       select coalesce(sum(cost_usd), 0)::text as cost, count(*)::int as calls, count(*) filter (where not ok)::int as failed,
              count(distinct user_id)::int as users, max(created_at) as last_used_at
       from sm_ai_usage where org_id = o.id and created_at >= ($1::date)::timestamp at time zone 'Asia/Tehran'
     ) u on true
     where o.deleted_at is null
     order by coalesce(u.cost, '0')::numeric desc, o.name`,
    [monthStart],
  );
  const orgs: AiAdminOrg[] = rows.map((r) => {
    const settings = normalizeSettings(r.settings);
    return {
      org_id: r.id,
      name: r.name,
      enabled: settings.enabled,
      disabled_by_platform: disabledByPlatform(policy, r.id) || !!r.ai_disabled,
      connections: r.connections,
      presets: (r.presets ?? []).filter(Boolean),
      status: r.connections === 0 ? "none" : r.errors > 0 ? "error" : r.ok > 0 ? "ok" : "unchecked",
      last_error: r.last_error?.kind ? r.last_error : null,
      month: { cost_usd: D(r.cost ?? "0").toDecimalPlaces(6).toFixed(), calls: r.calls ?? 0, errors: r.failed ?? 0 },
      users_month: r.users ?? 0,
      last_used_at: r.last_used_at,
    };
  });
  return {
    orgs,
    totals: {
      orgs_enabled: orgs.filter((b) => b.enabled && !b.disabled_by_platform && b.connections > 0).length,
      connections: orgs.reduce((n, b) => n + b.connections, 0),
      month_cost_usd: orgs.reduce((s, b) => s.plus(b.month.cost_usd), D(0)).toFixed(),
      month_calls: orgs.reduce((n, b) => n + b.month.calls, 0),
    },
    policy,
  };
}
