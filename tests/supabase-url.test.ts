import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

describe("normalizeSupabaseUrl", () => {
  const ref = "https://abcdefghijklmnopqrst.supabase.co";

  it("keeps a correct project URL", () => {
    expect(normalizeSupabaseUrl(ref)).toBe(ref);
    expect(normalizeSupabaseUrl(`${ref}/`)).toBe(ref);
  });

  it("strips the REST endpoint copied from the Data API page", () => {
    expect(normalizeSupabaseUrl(`${ref}/rest/v1/`)).toBe(ref);
    expect(normalizeSupabaseUrl(`${ref}/rest/v1`)).toBe(ref);
    expect(normalizeSupabaseUrl(`${ref}/auth/v1/token?grant_type=password`)).toBe(ref);
  });

  it("tolerates quotes, spaces and a missing scheme", () => {
    expect(normalizeSupabaseUrl(`  "${ref}/rest/v1/"  `)).toBe(ref);
    expect(normalizeSupabaseUrl("abcdefghijklmnopqrst.supabase.co")).toBe(ref);
  });

  it("converts a dashboard link to the project URL", () => {
    expect(normalizeSupabaseUrl("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api")).toBe(ref);
  });

  it("keeps self-hosted origins and path prefixes", () => {
    expect(normalizeSupabaseUrl("http://127.0.0.1:54321/rest/v1/")).toBe("http://127.0.0.1:54321");
    expect(normalizeSupabaseUrl("https://example.com/supabase/rest/v1")).toBe("https://example.com/supabase");
  });

  it("returns empty for missing values", () => {
    expect(normalizeSupabaseUrl(undefined)).toBe("");
    expect(normalizeSupabaseUrl("  ")).toBe("");
  });
});
