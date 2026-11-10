// Public pages expose only what the organisation published: the status page's public projection keeps each published
// service's name, status, message, bars, availability and group, and drops record ids (an opaque position key),
// numbers, the internal tier, subscriptions and the managers' fields (can_manage, the public key).
import { describe, expect, it } from "vitest";
import { publicView } from "@server/modules/service_portfolio/status";
import type { StatusPage } from "@shared/service_portfolio/api";

describe("the public status page projection", () => {
  it("keeps only what was published", () => {
    const page: StatusPage = {
      title: "وضعیت خدمات",
      overall: "degraded",
      days: 30,
      updated_at: "2026-11-08T10:00:00.000Z",
      can_manage: true,
      public_token: "secret-token-of-the-page-xxxxxxxx",
      services: [
        {
          id: "0f5a1b2c-3d4e-4f60-8a7b-9c0d1e2f3a4b",
          number: "SVC0000012",
          name: "ایمیل سازمانی",
          status: "degraded",
          since: "2026-11-08T08:00:00.000Z",
          note: "کندی در ارسال",
          bars: [{ day: "2026-11-08", status: "degraded", availability: 100, ...({ incident: "INC0000042" } as object) }],
          availability: 99.5,
          tier: "tier_1",
          group: "ارتباطات",
          subscribed: true,
        },
      ],
    };
    const out = publicView(page);
    const text = JSON.stringify(out);
    for (const hidden of ["0f5a1b2c", "9c0d1e2f3a4b", "SVC0000012", "tier_1", "secret-token", "INC0000042", "can_manage", "subscribed"]) expect(text).not.toContain(hidden);
    expect(out.services[0]).toMatchObject({ id: "s1", name: "ایمیل سازمانی", status: "degraded", note: "کندی در ارسال", availability: 99.5, group: "ارتباطات", number: null, tier: null });
    expect(Object.keys(out).sort()).toEqual(["days", "overall", "services", "title", "updated_at"]);
  });
});
