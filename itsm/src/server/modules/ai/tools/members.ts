// The organisation's members, as the members page shows them — and only to those who may see that page
// (users:view, the same check as GET /o/:org/members). E-mail and mobile follow the data policy; under
// «فقط جمع‌ها» (aggregates) names are hidden too and only counts by role remain.
import { z } from "zod";
import { ROLES, type Role } from "@shared/permissions";
import { formatNumber } from "@shared/format";
import { defineTool } from "./registry";
import { bounded, faNorm, faSql, jd, likePattern, maskId, personName, ref } from "./common";

const MAX_ROWS = 50;

export const listMembers = defineTool({
  name: "list_members",
  title_fa: "فهرست اعضا",
  description:
    "Lists the organisation's members (people with an account in it): name, role (owner, admin = manager, member, viewer), job title, whether active, last sign-in (Jalali), and counts by role. Optional filters: a role and a name/e-mail search. At most 50 rows (total_rows tells how many matched). E-mail and mobile are masked unless the data policy allows them. Use it for questions such as «who are the managers», «how many members are there».",
  input: z.object({
    role: z.enum(["owner", "admin", "member", "viewer"]).nullish().describe("Only members with this role"),
    query: z.string().max(80).nullish().describe("Part of a name or an e-mail address"),
    include_inactive: z.boolean().nullish().describe("Also list deactivated members (default false)"),
  }),
  kind: "read",
  area: "users",
  level: "view",
  async run(ctx, input, rt) {
    ctx.need("users", "view");
    const params: unknown[] = [ctx.org.id];
    const where = ["m.org_id = $1", "m.deleted_at is null"];
    if (!input.include_inactive) where.push("m.is_active");
    if (input.role) {
      params.push(input.role);
      where.push(`m.role = $${params.length}`);
    }
    if (input.query?.trim()) {
      params.push(likePattern(input.query));
      where.push(`(${faSql("u.full_name")} like $${params.length} or lower(u.email) like $${params.length})`);
    }
    const rows = await ctx.db.query<{ id: string; user_id: string; role: Role; title: string | null; is_active: boolean; full_name: string; email: string; mobile: string | null; last_login_at: string | null }>(
      `select m.id, m.user_id, m.role, m.title, m.is_active, u.full_name, u.email, u.mobile, u.last_login_at
       from sm_org_members m join sm_users u on u.id = m.user_id
       where ${where.join(" and ")}
       order by case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, u.full_name`,
      params,
    );
    const byRole: Record<string, number> = {};
    for (const r of rows) byRole[r.role] = (byRole[r.role] ?? 0) + 1;
    const counts = Object.entries(byRole).map(([role, n]) => ({ role, role_fa: ROLES[role as Role]?.title ?? role, members: n }));
    if (rt.dataPolicy === "aggregates") {
      return {
        data: { total_rows: rows.length, by_role: counts, note: "Names are hidden by the organisation's data policy (aggregates only)." },
        summary_fa: `${formatNumber(rows.length)} عضو`,
      };
    }
    const list = bounded(rows, MAX_ROWS);
    const out = list.rows.map((r, i) => ({
      name: personName(r.full_name, i + 1, rt),
      role: r.role,
      role_fa: ROLES[r.role]?.title ?? r.role,
      title: r.title,
      active: r.is_active,
      email: maskId(r.email, rt),
      mobile: maskId(r.mobile, rt),
      last_sign_in: jd(r.last_login_at),
    }));
    const tableRows = out.map((r) => ({ label: r.name, role: r.role_fa, title: r.title ?? "", active: r.active ? "فعال" : "غیرفعال", last_sign_in: r.last_sign_in ?? "—" }));
    const dataRef = tableRows.length ? await rt.putData(tableRows, { title: "اعضای سازمان" }) : undefined;
    const q = input.query?.trim() ? faNorm(input.query) : null;
    return {
      data: { members: out, by_role: counts, total_rows: list.total_rows, truncated: list.truncated, filters: { role: input.role ?? null, query: q } },
      summary_fa: `${formatNumber(list.total_rows)} عضو`,
      refs: [ref("member", ctx.org.id, "کاربران و دسترسی‌ها")],
      ...(dataRef
        ? {
            data_ref: dataRef,
            table: {
              title: "اعضای سازمان",
              columns: [
                { key: "label", title: "نام" },
                { key: "role", title: "نقش" },
                { key: "title", title: "عنوان شغلی" },
                { key: "active", title: "وضعیت" },
                { key: "last_sign_in", title: "آخرین ورود" },
              ],
              total_rows: tableRows.length,
            },
          }
        : {}),
    };
  },
});
