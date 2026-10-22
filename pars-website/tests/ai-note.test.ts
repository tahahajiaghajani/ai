import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as { key: string; value: Record<string, unknown> }[] }));

vi.mock("@/lib/db", () => ({
  db: () => ({
    from: () => ({
      upsert: async (row: { key: string; value: Record<string, unknown> }) => {
        h.rows.push(row);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));

import { AI_LAST_ERROR, AI_LAST_OK, noteAi } from "@/lib/ai/runtime";
import { ProviderError } from "@/lib/ai/providers";

const keys = () => h.rows.map((r) => r.key);

beforeEach(() => {
  h.rows = [];
  vi.useFakeTimers();
});

describe("noteAi", () => {
  it("writes the first success right after a failure, then throttles successes", async () => {
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    await noteAi({ ok: true, model: "m" });
    vi.setSystemTime(new Date("2026-10-22T10:01:00Z"));
    await noteAi({ ok: true, model: "m" });
    expect(keys()).toEqual([AI_LAST_OK]);

    vi.setSystemTime(new Date("2026-10-22T10:02:00Z"));
    const e = new ProviderError("high demand", 503, "overloaded");
    e.model = "m";
    await noteAi({ ok: false, error: e, where: "chat" });
    vi.setSystemTime(new Date("2026-10-22T10:03:00Z"));
    await noteAi({ ok: true, model: "m" });
    vi.setSystemTime(new Date("2026-10-22T10:04:00Z"));
    await noteAi({ ok: true, model: "m" });
    expect(keys()).toEqual([AI_LAST_OK, AI_LAST_ERROR, AI_LAST_OK]);
    expect(h.rows[1].value).toMatchObject({ kind: "overloaded", model: "m", status: 503, where: "chat" });
  });

  it("writes a forced success at once and records a time limit as a timeout", async () => {
    vi.setSystemTime(new Date("2026-10-22T11:00:00Z"));
    await noteAi({ ok: true, model: "m" }, { force: true });
    await noteAi({ ok: true, model: "m" }, { force: true });
    await noteAi({ ok: false, error: new DOMException("The operation was aborted due to timeout", "TimeoutError"), where: "ticket-suggestion" });
    expect(keys()).toEqual([AI_LAST_OK, AI_LAST_OK, AI_LAST_ERROR]);
    expect(h.rows[2].value).toMatchObject({ kind: "timeout", status: 504 });
  });
});
