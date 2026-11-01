import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";

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
