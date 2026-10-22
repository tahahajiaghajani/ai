import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: () => null }));

import { CONTACT_ENTRY_ID, contactEntry, getKnowledge } from "@/lib/knowledge";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";

describe("contact knowledge from site settings", () => {
  it("lists the admin-managed contact details and skips empty hours", () => {
    const e = contactEntry({ ...DEFAULT_SETTINGS.site.contact, phones: ["021-1", "021-2"], email: "a@b.ir", hoursFa: "", hoursEn: "" });
    expect(e.pinned).toBe(true);
    expect(e.body).toContain("021-1 و 021-2");
    expect(e.body).toContain("a@b.ir");
    expect(e.body).not.toContain("ساعات کاری");
  });
  it("includes hours once the admin sets them", () => {
    const e = contactEntry({ ...DEFAULT_SETTINGS.site.contact, hoursFa: "شنبه تا چهارشنبه", hoursEn: "" });
    expect(e.body).toContain("- ساعات کاری: شنبه تا چهارشنبه");
  });
  it("is appended to the knowledge the assistant receives", async () => {
    const { entries } = await getKnowledge();
    const c = entries.find((x) => x.id === CONTACT_ENTRY_ID);
    expect(c?.body).toContain(DEFAULT_SETTINGS.site.contact.email);
  });
});
