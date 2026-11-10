// /api/o/:org/access — the access model's own API (docs/spec/ACCESS.md § HTTP API): the caller's effective access,
// the role catalogue (permission matrix, diff, reset), member access (profile, roles, persona presets), group
// membership in bulk, the access checker and the organisation's access settings. The org structure itself (units,
// locations, groups, workspaces, profiles, roles) is also served by the generic engine API (/r/org_unit …).
import { z } from "zod";
import { router, body } from "../http/hono";
import { needRecentAuthOf } from "../auth/policy";
import { SCOPES } from "@shared/access";
import { FIELD_GROUPS } from "@shared/model/types";
import {
  addGroupMembers, applyPreset, checkAccess, deleteRole, listMemberAccess, listRoles, memberAccess, myAccess, needAccessView, resetRole,
  saveAccessSettings, saveMemberAccess, saveRole,
} from "../access";
import { accessSettings } from "../access/subject";

export const accessRoutes = router();

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const scope = z.enum(SCOPES as [string, ...string[]]);
const grantSchema = z
  .object({
    read: scope.optional(),
    create: z.boolean().optional(),
    write: scope.optional(),
    delete: scope.optional(),
    approve: z.boolean().optional(),
    admin: z.boolean().optional(),
  })
  .strict();
const roleSchema = z.object({
  name: z.string().trim().min(1, "نام نقش را وارد کنید").max(120),
  description: z.string().max(2000).nullish(),
  persona: z.enum(["requester", "agent", "admin"]),
  grants: z.record(z.string(), grantSchema),
  field_groups: z.array(z.enum(Object.keys(FIELD_GROUPS) as [string, ...string[]])).max(20),
  contains: z.array(z.string().max(41)).max(50),
  workspaces: z.enum(["member", "all"]),
  domains: z.enum(["own", "all"]),
  active: z.boolean().optional(),
  version: z.number().int().nullish(),
});

accessRoutes.get("/me", async (c) => c.json(await myAccess(c.get("ctx"))));

accessRoutes.get("/roles", async (c) => c.json(await listRoles(c.get("ctx"))));

accessRoutes.put("/roles/:key", async (c) => {
  needRecentAuthOf(c, c.get("ctx"));
  const input = await body(c, roleSchema);
  return c.json({ role: await saveRole(c.get("ctx"), c.req.param("key"), input as Parameters<typeof saveRole>[2]) });
});

accessRoutes.post("/roles/:key/reset", async (c) => {
  await resetRole(c.get("ctx"), c.req.param("key"));
  return c.json({ ok: true });
});

accessRoutes.delete("/roles/:key", async (c) => {
  needRecentAuthOf(c, c.get("ctx"));
  await deleteRole(c.get("ctx"), c.req.param("key"));
  return c.json({ ok: true });
});

accessRoutes.get("/settings", async (c) => {
  const ctx = c.get("ctx");
  await needAccessView(ctx);
  const s = accessSettings(ctx.org);
  return c.json({ domain_separation: s.domainSeparation, preset: s.preset });
});

accessRoutes.put("/settings", async (c) => {
  const input = await body(c, z.object({ domain_separation: z.boolean().optional(), preset: z.enum(["open", "need_to_know"]).optional() }));
  const s = await saveAccessSettings(c.get("ctx"), input);
  return c.json({ domain_separation: s.domainSeparation, preset: s.preset });
});

accessRoutes.get("/members", async (c) => c.json(await listMemberAccess(c.get("ctx"))));

accessRoutes.get("/members/:userId", async (c) => c.json(await memberAccess(c.get("ctx"), UUID.parse(c.req.param("userId")))));

accessRoutes.put("/members/:userId", async (c) => {
  const input = await body(c, z.record(z.string(), z.unknown()));
  // granting roles or workspaces is sensitive administration (a recent proof of identity)
  if ("roles" in input || "workspaces" in input || "persona" in input) needRecentAuthOf(c, c.get("ctx"));
  return c.json(await saveMemberAccess(c.get("ctx"), UUID.parse(c.req.param("userId")), input));
});

accessRoutes.post("/members/:userId/preset", async (c) => {
  needRecentAuthOf(c, c.get("ctx"));
  const input = await body(c, z.object({ preset: z.string().min(1) }));
  return c.json(await applyPreset(c.get("ctx"), UUID.parse(c.req.param("userId")), input.preset));
});

accessRoutes.post("/groups/:id/members", async (c) => {
  const input = await body(c, z.object({ user_ids: z.array(UUID).max(500), kind: z.enum(["member", "lead", "observer"]).optional() }));
  return c.json(await addGroupMembers(c.get("ctx"), UUID.parse(c.req.param("id")), input.user_ids, input.kind ?? "member"));
});

accessRoutes.post("/check", async (c) => {
  const input = await body(c, z.object({ user_id: UUID, table: z.string().min(1).max(60), record_id: UUID.nullish() }));
  return c.json(await checkAccess(c.get("ctx"), input));
});
