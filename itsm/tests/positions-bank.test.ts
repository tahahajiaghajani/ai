// F3 acceptance (design F §12, F3): for the bank demo, «رئیس شعبه» resolves to exactly one person per branch for 50
// sample requesters, and the designer's preview matches the runtime resolution.
// The bank is the demo pack's organisation (src/server/modules/demo/load.ts: its structure, branches, staff and branch
// heads — the steps «ساختار سازمانی و شعب», «گروه‌های پشتیبانی», «کارکنان و کارشناسان» and «رؤسای شعب»). Its 60 branches
// get a «رئیس شعبه» each from an HR spreadsheet (the holder import): the demo's branch managers where it has them, new
// heads elsewhere; one acts as «سرپرست (کفیل)», one branch's former head left yesterday. Five of the sample requesters
// sit in a counter («باجه») under their branch, so the resolution walks up the tree. The step is the canonical
// «تأیید رئیس شعبه»: an approve step (the requester never approves their own case) for the nearest branch up from the
// requester's unit.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx, updateIn } from "@server/engine";
import { newMemo, STEPS, type LoadMemo } from "@server/modules/demo/load";
import { resolveAssignees } from "@server/modules/positions";
import { tick } from "@server/jobs";
import { uuidv7 } from "@shared/id";
import { localDate } from "@shared/model/jalali-buckets";
import type { Ctx } from "@server/context";
import type { StepAssignees } from "@shared/process/assignees";

let e: EngineOrg;
let sys: Ctx;
let memo: LoadMemo;
/** branch unit → its head */
const headOf = new Map<string, string>();
/** sample requester → their branch */
const branchOf = new Map<string, string>();
const step: StepAssignees = { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] };

beforeAll(async () => {
  e = await engineOrg();
  sys = await systemCtx(e.cfg, e.org);
  // the modules' seeds first (the bank's roles among them), brought forward as the pack's load does
  for (let i = 0; i < 30; i++) {
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and (kind like '%seed%' or kind like '%install%')`, [e.org]);
    const r = await tick(e.cfg, { budgetMs: 60_000 });
    if (!r.ran && !r.more) break;
  }
  // the bank demo's organisation: structure and branches, groups, staff, branch heads
  memo = newMemo("small");
  for (const s of STEPS.slice(0, 4)) {
    expect(["org", "groups", "people", "branch_staff"]).toContain(s.key);
    for (let i = 0; i < 50 && !(await s.run({ cfg: e.cfg, orgId: e.org, memo, deadline: Date.now() + 600_000 }, sys)); i++);
  }
  expect(memo.branches).toHaveLength(60);
  const P = `/o/${e.org}`;
  await e.owner.post(`${P}/r/position`, { key: "branch_head", name: "رئیس شعبه", unit_kind: "branch" });
  // each branch's head: the demo's branch manager where it has one, a new head elsewhere
  const units = await e.db.query<{ id: string; code: string; manager_id: string | null }>(`select id, code, manager_id from sm_org_units where org_id = $1 and kind = 'branch' and deleted_at is null`, [e.org]);
  expect(units).toHaveLength(60);
  const rows: Record<string, string>[] = [];
  for (const [n, u] of units.entries()) {
    let head = u.manager_id;
    if (!head) {
      head = uuidv7();
      await e.db.query(`insert into sm_users (id, email, full_name) values ($1, $2, $3)`, [head, `head${n}.${e.org.slice(0, 6)}@aftab-bank.example`, `رئیس شعبهٔ ${u.code}`]);
      await e.db.query(`insert into sm_org_members (id, org_id, user_id, role) values ($1, $2, $3, 'member')`, [uuidv7(), e.org, head]);
      await sys.write((tx) => createIn(tx, sys, "member_profile", { user_id: head, name: `رئیس شعبهٔ ${u.code}`, org_unit_id: u.id, roles: ["requester"], persona: "requester" }, { trusted: true }));
    }
    headOf.set(u.id, head);
    const email = (await e.db.one<{ email: string }>(`select email from sm_users where id = $1`, [head]))!.email;
    rows.push({ "نقش سازمانی": "رئیس شعبه", "ایمیل": email, "کد شعبه": u.code, "نوع": n === 3 ? "سرپرست (کفیل)" : "اصلی" });
  }
  // one branch's former head left yesterday (an expired holder never resolves)
  const former = memo.people.employees[59];
  const formerEmail = (await e.db.one<{ email: string }>(`select email from sm_users where id = $1`, [former]))!.email;
  rows.push({ "نقش سازمانی": "رئیس شعبه", "ایمیل": formerEmail, "کد شعبه": units[5].code, "نوع": "اصلی", "تا تاریخ": localDate(Date.now() - 86_400_000, "Asia/Tehran") });
  const imported = await e.owner.post(`${P}/positions/holders/import`, { rows, dry_run: false });
  expect(imported).toMatchObject({ created: 61, errors: [] });
  // 50 sample requesters: the demo's branch employees, five of them in a counter under their branch
  const sample = memo.people.employees.slice(0, 50);
  const profiles = await e.db.query<{ id: string; user_id: string; org_unit_id: string }>(`select id, user_id, org_unit_id from sm_member_profiles where org_id = $1 and user_id = any($2::uuid[])`, [e.org, `{${sample.join(",")}}`]);
  expect(profiles).toHaveLength(50);
  for (const [n, p] of profiles.entries()) {
    branchOf.set(p.user_id, p.org_unit_id);
    if (n % 10 !== 0) continue;
    const counter = await sys.write((tx) => createIn(tx, sys, "org_unit", { name: `باجهٔ ${n}`, kind: "team", parent_id: p.org_unit_id }, { trusted: true }));
    await sys.write((tx) => updateIn(tx, sys, "member_profile", p.id, { org_unit_id: counter.id }, { trusted: true }));
  }
}, 1_200_000);

describe("the bank demo: «رئیس شعبه» for 50 sample requesters", () => {
  it("resolves to exactly one person per branch: the head of the requester's own branch", async () => {
    const found = new Map<string, string>();
    for (const [requester, branch] of branchOf) {
      const r = await resolveAssignees(e.db, sys, { step, action: "approve", label: "تأیید رئیس شعبه", requestedBy: requester });
      expect(r.status).toBe("ok");
      expect(r.people).toHaveLength(1);
      expect(r.people[0]).toMatchObject({ user: headOf.get(branch), delegatedFrom: null, via: { kind: "position", position: "branch_head", unit: branch } });
      found.set(branch, r.people[0].user);
    }
    // one head per branch, and different branches' requesters reach different heads
    expect(new Set(found.values()).size).toBe(found.size);
    expect(found.size).toBeGreaterThanOrEqual(45);
  });

  it("the preview gives each sample requester exactly what the runtime does", async () => {
    for (const requester of branchOf.keys()) {
      const runtime = await resolveAssignees(e.db, sys, { step, action: "approve", requestedBy: requester });
      const preview = await e.owner.post(`/o/${e.org}/positions/resolve`, { step, action: "approve", requester });
      expect({ status: preview.status, people: preview.people, found: preview.found, notes: preview.notes }).toEqual({ status: runtime.status, people: runtime.people, found: runtime.found, notes: runtime.notes });
      expect(preview.lines).toHaveLength(1);
    }
  });
});
