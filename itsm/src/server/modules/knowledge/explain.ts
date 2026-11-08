// «چرا می‌بیند؟» for knowledge (KB-033): for a member and an article, every layer that decides — the grant in knowledge,
// the base's audience and «هرگز نبینند», its internal kind, its secure workspace, the category's audience, the
// article's own audience and deny lists, «فقط کارشناسان», the state (drafts stay with contributors) — and whether AI may
// use the article for that member. Each layer is a deterministic check against the same rules the SQL applies; the
// final verdict is the SQL's (`readableIds` with the member's context). Knowledge administrators only, and only for
// articles they can read themselves.
import type { KbExplain } from "@shared/knowledge/api";
import { LIVE_STATES, READER_STATES } from "@shared/tables/knowledge";
import { grantIn } from "@shared/access/model";
import type { Ctx } from "../../context";
import { get } from "../../engine";
import { forbidden } from "../../http/errors";
import { memberCtx, readableIds, subjectOf } from "../../access";
import { access } from "../../access/provider";
import { baseOf, categoryOf, isKbAdmin, memberNames, type Row } from "./common";

export async function explainAccess(ctx: Ctx, articleId: string, userId: string): Promise<KbExplain> {
  if (!isKbAdmin(ctx)) throw forbidden("عیب‌یابی دسترسی دانش با مدیران دانش است");
  const a = (await get(ctx, "kb_article", articleId)).row as Row; // the admin must read it
  const m = await memberCtx(ctx.cfg, ctx.org.id, userId);
  const s = subjectOf(m);
  const base = await baseOf(ctx.db, ctx, a.base_id);
  const category = a.category_id ? await categoryOf(ctx.db, ctx, a.category_id) : null;
  const layers: KbExplain["layers"] = [];
  const g = grantIn(s.eff, "knowledge");
  layers.push({ key: "grant", label: "دسترسی به دانش", ok: g.read !== "none", detail: g.read === "none" ? "نقش‌های این عضو دسترسی خواندن دانش ندارند" : `خواندن: ${g.read}` });
  const me = (list: unknown) => Array.isArray(list) && list.includes(userId);
  const anyOf = (list: unknown, set: string[]) => Array.isArray(list) && list.some((x) => set.includes(String(x)));
  if (base) {
    const denied = me(base.deny_users) || anyOf(base.deny_groups, s.groups) || (!!s.unitId && anyOf(base.x_units, [s.unitId]));
    const contributor = base.owner_id === userId || (!!base.manager_group_id && s.groups.includes(base.manager_group_id)) || me(base.k_users) || anyOf(base.k_groups, s.groups);
    const audience = base.read_mode === "everyone" || me(base.read_users) || anyOf(base.read_groups, s.groups) || (!!s.unitId && anyOf(base.r_units, [s.unitId]));
    layers.push({ key: "base_deny", label: `«هرگز نبینند» پایگاه «${base.name}»`, ok: !denied, detail: denied ? "این عضو در فهرست منع پایگاه است (منع همیشه برنده است)" : "در فهرست منع نیست" });
    layers.push({ key: "base_audience", label: "مخاطبان پایگاه", ok: contributor || audience, detail: contributor ? "مشارکت‌کنندهٔ پایگاه است" : base.read_mode === "everyone" ? "پایگاه برای همهٔ خوانندگان دانش است" : audience ? "در افراد، گروه‌ها یا واحدهای مخاطب است" : "در مخاطبان نام‌برده نیست" });
    const internal = access().hasFieldGroup(m, "internal");
    if (base.kind === "internal") layers.push({ key: "base_internal", label: "پایگاه داخلی", ok: internal || base.owner_id === userId || (!!base.manager_group_id && s.groups.includes(base.manager_group_id)) || me(base.access_list), detail: internal ? "کارشناس است (گروه فیلد «داخلی»)" : "فقط کارشناسان پایگاه داخلی را می‌بینند" });
    if (base.workspace_id) {
      const secure = s.secureWorkspaces.includes(base.workspace_id);
      layers.push({ key: "workspace", label: "فضای کاری", ok: !secure || s.workspaces.includes(base.workspace_id), detail: secure ? (s.workspaces.includes(base.workspace_id) ? "عضو فضای کاری امن است" : "فضای کاری امن است و این عضو عضو آن نیست") : "فضای کاری عادی" });
    }
  }
  if (category) {
    const ok = category.c_all !== false || me(category.c_users) || anyOf(category.c_groups, s.groups) || (!!s.unitId && anyOf(category.c_units, [s.unitId])) || anyOf(category.m_groups, s.groups);
    layers.push({ key: "category", label: `مخاطبان دستهٔ «${category.name}»`, ok, detail: category.c_all !== false ? "دسته محدودیتی ندارد" : ok ? "در مخاطبان دسته است" : "دسته به افراد، گروه‌ها یا واحدهای دیگری محدود شده است" });
  }
  const aDenied = me(a.deny_users) || anyOf(a.deny_groups, s.groups) || (!!s.unitId && anyOf(a.x_units, [s.unitId]));
  layers.push({ key: "article_deny", label: "«هرگز نبینند» مقاله", ok: !aDenied, detail: aDenied ? "این عضو در فهرست منع مقاله است" : "در فهرست منع نیست" });
  if (a.audience_mode === "narrow") {
    const ok = me(a.read_users) || anyOf(a.read_groups, s.groups) || (!!s.unitId && anyOf(a.r_units, [s.unitId]));
    layers.push({ key: "article_audience", label: "مخاطبان مقاله", ok, detail: ok ? "در مخاطبان مقاله است" : "مقاله به مخاطبان دیگری محدود شده است" });
  }
  if (a.confidential) {
    const ok = access().hasFieldGroup(m, "internal") || a.author_id === userId || a.owner_id === userId || (!!a.owner_group_id && s.groups.includes(a.owner_group_id)) || me(a.access_list);
    layers.push({ key: "internal", label: "فقط کارشناسان", ok, detail: ok ? "کارشناس است یا از افراد مقاله" : "مقالهٔ داخلی است و این عضو کارشناس نیست" });
  }
  const contributor = a.author_id === userId || a.owner_id === userId || (!!a.owner_group_id && s.groups.includes(a.owner_group_id)) || me(a.reviewer_ids) || (base ? me(base.k_users) || anyOf(base.k_groups, s.groups) : false);
  const stateOk = READER_STATES.includes(a.state) || (a.state === "draft" && a.kcs_confidence === "wip") || contributor;
  layers.push({ key: "state", label: "وضعیت مقاله", ok: stateOk, detail: stateOk ? (contributor ? "از مشارکت‌کنندگان است" : "منتشرشده است") : "پیش‌نویس‌ها را فقط مشارکت‌کنندگان می‌بینند" });
  const readable = (await readableIds(m, "kb_article", [articleId])).has(articleId);
  // what AI may use for this member
  let ai = { allowed: true, reason: "هوش مصنوعی می‌تواند با ارجاع از آن پاسخ دهد" };
  if (!readable) ai = { allowed: false, reason: "این عضو مقاله را نمی‌بیند" };
  else if (!LIVE_STATES.includes(a.state)) ai = { allowed: false, reason: "فقط مقاله‌های منتشرشده در پاسخ‌ها می‌آیند" };
  else if (a.ai_use === "none" || base?.ai_enabled === false) ai = { allowed: false, reason: "استفادهٔ هوش مصنوعی از این مقاله یا پایگاه خاموش است" };
  else if (a.classification === "secret" || base?.classification === "secret") ai = { allowed: false, reason: "محتوای «سری» در پاسخ‌ها نمی‌آید" };
  else if ((a.ai_requesters === false || base?.ai_requesters === false) && !access().hasFieldGroup(m, "internal")) ai = { allowed: false, reason: "این مقاله فقط در پاسخ به کارشناسان می‌آید" };
  else if (a.ai_use === "link_only") ai = { allowed: true, reason: "فقط ارجاع می‌دهد؛ متن مقاله نقل نمی‌شود" };
  const [name] = await memberNames(ctx.db, ctx.org.id, [userId]);
  return { user: { id: userId, name: name ?? null }, readable, layers, ai };
}
