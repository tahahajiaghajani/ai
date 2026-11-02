import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { memberChangeRule, OWNER_ONLY_MESSAGE, permissionMap, type Area, type Level, type MemberActor, type Role } from "@shared/permissions";

describe("platform admin", () => {
  let admin: Client;
  let other: Client;
  beforeAll(async () => {
    const s = await makeServer();
    admin = new Client(s.app);
    other = new Client(s.app);
    await signupWithOrg(admin); // the first account administers the platform
    await other.post("/auth/signup", { email: "clerk@example.com", password: "another-pass-1", full_name: "کاربر دوم" });
  });

  it("is only for platform admins", async () => {
    await other.get("/admin/stats", 403);
    const { stats } = await admin.get("/admin/stats");
    expect(stats).toMatchObject({ users: 2, orgs: 1, disabled_users: 0 });
    expect(stats.db_bytes).toBeGreaterThan(0);
    const { orgs } = await admin.get("/admin/orgs");
    expect(orgs[0]).toMatchObject({ name: "فروشگاه آزمایشی", members: 1 });
  });

  it("disables an account and signs it out everywhere", async () => {
    const { users } = await admin.get("/admin/users?q=clerk");
    expect(users).toHaveLength(1);
    await admin.patch(`/admin/users/${users[0].id}`, { disabled: true });
    await other.get("/auth/me", 401);
    await other.post("/auth/login", { email: "clerk@example.com", password: "another-pass-1" }, 403);
    await admin.patch(`/admin/users/${users[0].id}`, { disabled: false });
    await other.post("/auth/login", { email: "clerk@example.com", password: "another-pass-1" });
    const me = await admin.get("/auth/me");
    await admin.patch(`/admin/users/${me.user.id}`, { disabled: true }, 400);
  });
});

// The members page offers only what the server allows: both use this one rule.
describe("memberChangeRule (members page and API)", () => {
  const actorOf = (role: Role, overrides: Partial<Record<Area, Level>> = {}, user_id = "me"): MemberActor => ({ user_id, role, permissions: permissionMap(role, overrides) });
  const g = (user_id: string, role: Role, overrides: Partial<Record<Area, Level>> = {}) => ({ user_id, role, overrides });
  const delegate = actorOf("viewer", { users: "edit" });

  it("locks your own row, owners and members above you below the owner", () => {
    expect(memberChangeRule(delegate, g("me", "viewer", { users: "edit" }), null)).toMatch(/خودتان/);
    expect(memberChangeRule(delegate, g("me", "viewer", { users: "edit" }), g("me", "viewer", { users: "edit" }))).toBeNull();
    expect(memberChangeRule(delegate, g("o", "owner"), null)).toBe(OWNER_ONLY_MESSAGE);
    expect(memberChangeRule(delegate, g("a", "accountant"), null)).toMatch(/از شما بیشتر است/);
    expect(memberChangeRule(delegate, g("p", "viewer"), null)).toBeNull();
    expect(memberChangeRule(actorOf("owner"), g("me", "owner"), null)).toBeNull();
  });

  it("offers only roles and levels at or below the actor's own", () => {
    const offered = (["owner", "admin", "accountant", "viewer", "sales"] as Role[]).filter((r) => !memberChangeRule(delegate, null, g("", r)));
    expect(offered).toEqual(["viewer"]);
    expect(memberChangeRule(delegate, g("p", "viewer"), g("p", "viewer", { users: "edit" }))).toBeNull();
    expect(memberChangeRule(delegate, g("p", "viewer"), g("p", "viewer", { users: "full" }))).toMatch(/بیشتر از دسترسی خودتان/);
    expect(memberChangeRule({ ...actorOf("owner"), support: true }, g("p", "viewer"), g("p", "sales"))).toMatch(/خود کسب‌وکار/);
  });
});
