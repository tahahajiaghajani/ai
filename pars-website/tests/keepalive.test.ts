import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ops: [] as string[], secret: "" }));

vi.mock("@/lib/db", () => ({
  db: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.upsert = () => (h.ops.push("upsert"), q);
      q.select = () => (h.ops.push("select"), q);
      q.limit = () => q;
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
  }),
}));
vi.mock("@/lib/env", () => ({ env: { get cronSecret() { return h.secret; } } }));

import { GET } from "@/app/api/keepalive/route";

const call = (headers: Record<string, string> = {}) => GET(new Request("http://localhost/api/keepalive", { headers }));

beforeEach(() => {
  h.ops = [];
  h.secret = "";
});

describe("keepalive", () => {
  it("records the run for Vercel's cron", async () => {
    expect((await call({ "user-agent": "vercel-cron/1.0" })).status).toBe(200);
    expect(h.ops).toEqual(["upsert"]);
  });
  it("only reads for anyone else, so the 'last run' cannot be faked", async () => {
    expect((await call({ "user-agent": "curl/8" })).status).toBe(200);
    expect(h.ops).toEqual(["select"]);
  });
  it("requires the secret when CRON_SECRET is set", async () => {
    h.secret = "s3cret";
    expect((await call({ "user-agent": "vercel-cron/1.0" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret" })).status).toBe(200);
    expect(h.ops).toEqual(["upsert"]);
  });
});
