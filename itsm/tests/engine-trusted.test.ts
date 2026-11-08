// Trusted writes and system fields (docs/spec/ENGINE.md § Record service): user input never sets `system` or
// `readonly` fields (API, untrusted engine calls), trusted server code may — a module stamping its own bookkeeping
// from a service or a job no longer needs to declare such fields `readonly`.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { updateIn } from "@server/engine/write";
import { tableDef } from "@shared/tables";

describe("trusted writes and system fields", () => {
  let e: EngineOrg;
  let base = "";

  beforeAll(async () => {
    e = await engineOrg();
    base = `/o/${e.org}/r/todo`;
  });

  it("the API ignores system fields; trusted server code sets them", async () => {
    expect(tableDef("todo")!.fields.find((f) => f.name === "reopen_count")?.system).toBe(true);
    const row = (await e.owner.post(base, { short_description: "کار" })).row;
    const patched = (await e.owner.patch(`${base}/${row.id}`, { reopen_count: 7, version: row.version })).row;
    expect(patched.reopen_count ?? 0).toBe(0);
    const ctx = await e.ctxOf(e.ownerId);
    const untrusted = await ctx.write((tx) => updateIn(tx, ctx, "todo", row.id, { reopen_count: 7 }));
    expect(untrusted.reopen_count ?? 0).toBe(0);
    const trusted = await ctx.write((tx) => updateIn(tx, ctx, "todo", row.id, { reopen_count: 7 }, { trusted: true }));
    expect(trusted.reopen_count).toBe(7);
    expect((await e.owner.get(`${base}/${row.id}`)).row.reopen_count).toBe(7);
  });
});
