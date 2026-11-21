// What the rest of the system does with a row that is gone (docs/DEMO_FA.md «حذف کامل», release 1.1.5): the demo pack's
// purge removes people, groups and records that definitions built on top of the pack still named before the purge
// cleaned them — and a person can leave or a group be deleted at any time. None of it may stop real work:
//   · a field whose default names a row that no longer exists: the default is dropped and the record is made (before
//     1.1.5 every new record was refused with «… پیدا نشد» until someone found the field's settings)
//   · a flow whose steps name a row that no longer exists: the designer and «انتشار» say which step (before 1.1.5 the
//     flow published and failed on every run)
// (An approval level whose people can no longer approve waits instead of being skipped: tests/sla-approvals.test.ts.)
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { N, flowsKit, line, type FlowsKit } from "./flows-helpers";
import { uuidv7 } from "@shared/id";

describe("a row that is gone", () => {
  let e: EngineOrg;
  let k: FlowsKit;
  let P = "";
  beforeAll(async () => {
    e = await engineOrg();
    k = flowsKit(e);
    P = `/o/${e.org}`;
  });

  it("a field's default naming it is dropped; the record is made; a value given is still checked", async () => {
    const left = uuidv7(); // a person who is no longer in the organisation
    const f = (await e.owner.post(`${P}/r/field_def`, { name: "u_reviewer", label: "بازبین", type: "user", default_value: left })).row;
    await e.owner.post(`${P}/fields/attach`, { table: "todo", field: f.id }, 201);
    const made = (await e.owner.post(`${P}/r/todo`, { short_description: "کار تازه" })).row;
    expect(made.u_reviewer ?? null).toBeNull();
    // the same id given by the person is refused as before
    await e.owner.post(`${P}/r/todo`, { short_description: "کار دیگر", u_reviewer: left }, 400);
    // a default naming a live row still applies
    await e.owner.patch(`${P}/r/field_def/${f.id}`, { default_value: e.ownerId, version: f.version });
    const next = (await e.owner.post(`${P}/r/todo`, { short_description: "کار سوم" })).row;
    expect(next.u_reviewer).toBe(e.ownerId);
  });

  it("a flow's step naming it is a problem of that step", async () => {
    const left = uuidv7();
    const goneGroup = uuidv7();
    const id = await k.flow({}, line(N("u", "update_record", { values: { assigned_to: left, assignment_group_id: goneGroup } }), N("n", "notify", { to: { users: [left] }, subject: "x", body: "y" })));
    const r = await e.owner.post(`${P}/flows/${id}/validate`, {});
    const mine = r.problems.filter((p: { message: string }) => p.message.includes("دیگر وجود ندارد"));
    expect(mine).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", node: "u", field: "values" }),
      expect.objectContaining({ level: "error", node: "n", field: "to" }),
    ]));
    // publishing is refused for the same reason
    const refused = await e.owner.post(`${P}/flows/${id}/publish`, {}, 400);
    expect(refused.error.details.problems.some((p: { node: string; message: string }) => p.node === "u" && p.message.includes("دیگر وجود ندارد"))).toBe(true);
    // live rows are no problem
    const ok = await k.flow({}, line(N("u", "update_record", { values: { assigned_to: e.ownerId } })));
    const fine = await e.owner.post(`${P}/flows/${ok}/validate`, {});
    expect(fine.problems.filter((p: { message: string }) => p.message.includes("دیگر وجود ندارد"))).toEqual([]);
  });
});
