// One policy, two forms: the SQL predicate (src/server/access/predicate.ts) and the in-memory evaluator
// (@shared/access evaluate.ts) must agree on every (subject, record, operation). Property-style: random organisations
// (unit trees with domains, nested and restricted groups in workspaces, secure workspaces, profiles with managers,
// delegates and absences, memberships of every kind including expired ones, built-in and random custom roles) and
// random records, generated from fixed seeds so a failure replays exactly. Every member is checked with domain
// separation off and on, plus a support session, for read, write and delete.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TICKET, rng } from "./fixtures/access";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import type { Db } from "@server/db";
import { buildSubject, loadOrgSnapshot, readSql, registerParticipantSource, writeSql } from "@server/access";
import { canReadRow, composeEffective, grantIn, roleCatalog, scopeColumns, scopeMatch, writeMode, SCOPES, type Subject } from "@shared/access";
import { tableDef } from "@shared/tables";
import type { TableDef } from "@shared/model/types";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

type R = ReturnType<typeof rng>;

function uid(r: R): string {
  const h = () => Math.floor(r.next() * 16).toString(16);
  const s = (n: number) => Array.from({ length: n }, h).join("");
  return `${s(8)}-${s(4)}-4${s(3)}-a${s(3)}-${s(12)}`;
}

const j = (v: unknown) => JSON.stringify(v);

async function generate(seed: number) {
  const r = rng(seed);
  const org = uid(r);
  await db.query(`insert into sm_orgs (id, name) values ($1, $2)`, [org, `سازمان ${seed}`]);
  const users = Array.from({ length: 10 }, () => uid(r));
  const workspaces = [0, 1, 2].map((i) => ({ id: uid(r), secure: i === 1 }));
  for (const [i, w] of workspaces.entries()) {
    await db.query(`insert into sm_workspaces (id, org_id, key, name, secure, active, is_default) values ($1, $2, $3, $4, $5, true, false)`, [w.id, org, `ws${i}`, `فضای ${i}`, w.secure]);
  }
  const units: { id: string; path: string; domain: boolean }[] = [];
  for (let i = 0; i < 9; i++) {
    const id = uid(r);
    const parent = i === 0 ? null : r.maybe(units, 0.85);
    const path = `${parent?.path ?? "/"}${id}/`;
    const domain = r.chance(0.3);
    units.push({ id, path, domain });
    await db.query(
      `insert into sm_org_units (id, org_id, name, kind, parent_id, path, depth, manager_id, is_domain, active) values ($1, $2, $3, 'department', $4, $5, $6, $7, $8, true)`,
      [id, org, `واحد ${i}`, parent?.id ?? null, path, path.split("/").filter(Boolean).length, r.maybe(users, 0.4), domain],
    );
  }
  const custom = [0, 1].map((i) => ({
    key: `custom_${i}`,
    grants: {
      incident: { read: r.pick(SCOPES), write: r.pick(SCOPES), delete: r.pick(SCOPES), create: r.chance(0.5) },
      work: { read: r.pick(SCOPES), write: r.pick(SCOPES) },
    },
    workspaces: r.pick(["member", "all"]),
    domains: r.pick(["own", "all"]),
    field_groups: r.some(["internal", "security", "hr", "financial"], 0.4),
  }));
  for (const c of custom) {
    await db.query(
      `insert into sm_roles (id, org_id, key, name, persona, grants, field_groups, contains, workspaces, domains, active)
       values ($1, $2, $3, $4, 'agent', $5::jsonb, $6::jsonb, '[]'::jsonb, $7, $8, true)`,
      [uid(r), org, c.key, c.key, j(c.grants), j(c.field_groups), c.workspaces, c.domains],
    );
  }
  const roleKeys = ["requester", "agent", "team_lead", "service_desk_manager", "vendor_agent", "auditor", "hr_agent", "tenant_admin", "cab_member", ...custom.map((c) => c.key)];
  const groups: { id: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const id = uid(r);
    const parent = r.maybe(groups, 0.4);
    groups.push({ id });
    await db.query(
      `insert into sm_groups (id, org_id, name, types, parent_id, restricted, active, roles, workspace_id)
       values ($1, $2, $3, '["assignment"]'::jsonb, $4, $5, true, $6::jsonb, $7)`,
      [id, org, `گروه ${i}`, parent?.id ?? null, r.chance(0.25), j(r.some(roleKeys, 0.1)), r.maybe(workspaces, 0.6)?.id ?? null],
    );
  }
  const domainUnits = units.filter((u) => u.domain);
  for (const u of users) {
    await db.query(
      `insert into sm_member_profiles (id, org_id, user_id, name, persona, roles, org_unit_id, manager_id, delegate_id, out_of_office, ooo_until, workspaces, domain_unit_id, vip)
       values ($1, $2, $3, 'عضو', 'agent', $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11, false)`,
      [
        uid(r), org, u, j(r.some(roleKeys, 0.2)), r.maybe(units, 0.8)?.id ?? null, r.maybe(users.filter((x) => x !== u), 0.5),
        r.maybe(users.filter((x) => x !== u), 0.3), r.chance(0.3), r.chance(0.2) ? new Date(Date.now() - 3600_000).toISOString() : null,
        j(r.some(workspaces.map((w) => w.id), 0.3)), r.maybe(domainUnits, 0.15)?.id ?? null,
      ],
    );
    for (const g of r.some(groups, 0.3)) {
      await db.query(
        `insert into sm_group_members (id, org_id, group_id, user_id, kind, valid_to) values ($1, $2, $3, $4, $5, $6)`,
        [uid(r), org, g.id, u, r.pick(["member", "member", "lead", "observer"]), r.chance(0.1) ? new Date(Date.now() - 60_000).toISOString() : null],
      );
    }
  }
  const allUnits = units.map((u) => u.id);
  for (const def of [TICKET, tableDef("todo")!]) {
    for (let i = 0; i < 90; i++) {
      await db.query(
        `insert into ${def.table} (id, org_id, no, short_description, state, caller_id, requested_for, opened_by, assigned_to, watch_list,
                                   assignment_group_id, workspace_id, unit_id, domain_id${def === TICKET ? ", confidential, access_list" : ""})
         values ($1, $2, $3, 'رکورد', 'new', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12${def === TICKET ? ", $13, $14::jsonb" : ""})`,
        [
          uid(r), org, i + 1, r.maybe(users, 0.7), r.maybe(users, 0.3), r.maybe(users, 0.5), r.maybe(users, 0.5), j(r.some(users, 0.1)),
          r.maybe(groups, 0.7)?.id ?? null, r.maybe(workspaces, 0.5)?.id ?? null, r.maybe(allUnits, 0.7), r.maybe(domainUnits.map((u) => u.id), 0.5),
          ...(def === TICKET ? [r.chance(0.3), j(r.some(users, 0.1))] : []),
        ],
      );
    }
  }
  const roles = users.map(() => r.pick(["member", "member", "member", "viewer", "admin"] as const));
  return { org, users, roles };
}

async function ids(sql: string, params: unknown[]): Promise<string[]> {
  return (await db.query<{ id: string }>(sql, params)).map((x) => x.id).sort();
}

async function compare(s: Subject, def: TableDef, rows: Record<string, unknown>[], tally: { read: number; write: number; total: number }) {
  const label = `${def.key} user=${s.userId} kind=${s.kind} roles=${s.eff.roles.join(",")} legacy=${s.eff.legacy} sep=${s.domainSeparation}`;
  let params: unknown[] = [s.orgId];
  const read = await ids(`select t.id from ${def.table} t where t.org_id = $1 and ${readSql(s, def, "t", params)}`, params);
  expect(read, `read ${label}`).toEqual(rows.filter((row) => canReadRow(s, def, row)).map((x) => String(x.id)).sort());
  params = [s.orgId];
  const write = await ids(`select t.id from ${def.table} t where t.org_id = $1 and ${writeSql(s, def, "t", params)}`, params);
  expect(write, `write ${label}`).toEqual(rows.filter((row) => writeMode(s, def, row) !== null).map((x) => String(x.id)).sort());
  params = [s.orgId];
  const del = await ids(`select t.id from ${def.table} t where t.org_id = $1 and ${writeSql(s, def, "t", params, "delete")}`, params);
  expect(del, `delete ${label}`).toEqual(rows.filter((row) => writeMode(s, def, row, "delete") === "full").map((x) => String(x.id)).sort());
  // the scope ladder is cumulative: a wider scope never reaches fewer rows
  const c = scopeColumns(def);
  for (const row of rows) {
    for (let i = 1; i < SCOPES.length - 1; i++) {
      if (scopeMatch(s, c, row, SCOPES[i])) expect(scopeMatch(s, c, row, SCOPES[i + 1]), `${SCOPES[i]} ⊄ ${SCOPES[i + 1]} ${label}`).toBe(true);
    }
  }
  tally.read += read.length;
  tally.write += write.length;
  tally.total += rows.length;
}

describe("SQL predicate == in-memory evaluator", () => {
  for (const seed of [11, 23, 37, 41, 59, 73]) {
    it(`agrees on a random organisation (seed ${seed})`, async () => {
      const { org, users, roles } = await generate(seed);
      const snap = await loadOrgSnapshot(db, org);
      const tally = { read: 0, write: 0, total: 0 };
      for (const def of [TICKET, tableDef("todo")!]) {
        const rows = await db.query<Record<string, unknown>>(`select * from ${def.table} where org_id = $1`, [org]);
        for (const [i, u] of users.entries()) {
          for (const domainSeparation of [false, true]) {
            for (const preset of ["open", "need_to_know"] as const) {
              const { subject } = buildSubject(snap, { domainSeparation, preset }, org, u, roles[i], null);
              await compare(subject, def, rows, tally);
            }
          }
        }
        // a support session: no memberships, the organisation's secure workspaces and restricted groups closed
        for (const level of ["view", "edit"] as const) {
          const eff = composeEffective({ role: null, levels: { users: "view", settings: "view", work: level === "edit" ? "full" : "view", ai: "none", reports: "view", integrations: "view" }, explicit: [], catalog: roleCatalog(snap.roles), support: level });
          const s: Subject = {
            orgId: org, userId: users[0], kind: "support", eff, groups: [], writeGroups: [], ledGroups: [], unitId: null, unitTree: [], managedTree: [],
            reportees: [], delegators: [], domainSeparation: true, domainId: null, domainTree: [], workspaces: [],
            secureWorkspaces: [...snap.workspaces.values()].filter((w) => w.secure).map((w) => w.id),
            restrictedGroups: [...snap.groups.values()].filter((g) => g.restricted).map((g) => g.id),
          };
          await compare(s, def, rows, tally);
        }
      }
      // the random organisations exercise both outcomes
      expect(tally.read).toBeGreaterThan(0);
      expect(tally.read).toBeLessThan(tally.total);
      expect(tally.write).toBeGreaterThan(0);
      expect(tally.write).toBeLessThan(tally.read);
    });
  }
});


// Participants and readers: a `scoped` source (adds rows to subjects who read the area), a `grant` source (reads the
// rows it names without any grant in the area — the approver grant), `bounded` sources of both reaches (never past a
// secure workspace or a restricted group — the service owners) and a readers field (read only), on the same random
// organisations. The JS form gets the sources' verdicts as `extra`, exactly as the provider probes them in SQL.
describe("SQL predicate == in-memory evaluator with participants and readers", () => {
  const scoped = new Map<string, Set<string>>();
  const granted = new Map<string, Set<string>>();
  // bounded sources (a service's owners): never past a secure workspace or a restricted group, with either reach
  const boundedScoped = new Map<string, Set<string>>();
  const boundedGranted = new Map<string, Set<string>>();
  const off: (() => void)[] = [];
  const READERS: TableDef = { ...TICKET, scope: { ...TICKET.scope, readers: ["resolved_by"] } };
  const sqlOf = (m: Map<string, Set<string>>) => (def: TableDef, alias: string, params: unknown[], userId: string) => {
    if (def.key !== TICKET.key) return null;
    params.push(`{${[...(m.get(userId) ?? [])].join(",")}}`);
    return `${alias}.id = any($${params.length}::uuid[])`;
  };

  beforeAll(() => {
    off.push(registerParticipantSource({ name: "parity_scoped", sql: sqlOf(scoped) }));
    off.push(registerParticipantSource({ name: "parity_grant", reach: "grant", sql: sqlOf(granted) }));
    off.push(registerParticipantSource({ name: "parity_bounded_scoped", bounded: true, sql: sqlOf(boundedScoped) }));
    off.push(registerParticipantSource({ name: "parity_bounded_grant", reach: "grant", bounded: true, sql: sqlOf(boundedGranted) }));
  });
  afterAll(() => off.forEach((f) => f()));

  for (const seed of [17, 43]) {
    it(`agrees with sources of both reaches and a readers field (seed ${seed})`, async () => {
      const { org, users, roles } = await generate(seed);
      const r = rng(seed * 7 + 1);
      const tickets = await db.query<Record<string, unknown>>(`select id from ${TICKET.table} where org_id = $1 order by no`, [org]);
      for (const t of tickets) if (r.chance(0.4)) await db.query(`update ${TICKET.table} set resolved_by = $2 where id = $1`, [t.id, r.pick(users)]);
      for (const u of users) {
        scoped.set(u, new Set(r.some(tickets, 0.15).map((t) => String(t.id))));
        granted.set(u, new Set(r.some(tickets, 0.15).map((t) => String(t.id))));
        boundedScoped.set(u, new Set(r.some(tickets, 0.15).map((t) => String(t.id))));
        boundedGranted.set(u, new Set(r.some(tickets, 0.15).map((t) => String(t.id))));
      }
      const snap = await loadOrgSnapshot(db, org);
      const rows = await db.query<Record<string, unknown>>(`select * from ${TICKET.table} where org_id = $1`, [org]);
      let none = 0;
      let viaGrant = 0;
      for (const def of [TICKET, READERS]) {
        for (const [i, u] of users.entries()) {
          for (const [k, domainSeparation] of [false, true, false].entries()) {
            const { subject: built } = buildSubject(snap, { domainSeparation, preset: "need_to_know" }, org, u, roles[i], null);
            // the third pass: the same member with no grant in the area (a requester who only approves)
            const s: Subject = k < 2 ? built : { ...built, eff: { ...built.eff, grants: { ...built.eff.grants, incident: grantIn({ grants: {} }, "incident") } } };
            const params: unknown[] = [s.orgId];
            const read = await ids(`select t.id from ${def.table} t where t.org_id = $1 and ${readSql(s, def, "t", params)}`, params);
            const extra = (row: Record<string, unknown>) => ({
              participant: scoped.get(u)!.has(String(row.id)),
              granted: granted.get(u)!.has(String(row.id)),
              boundedParticipant: boundedScoped.get(u)!.has(String(row.id)),
              boundedGranted: boundedGranted.get(u)!.has(String(row.id)),
            });
            const label = `${def === READERS ? "readers" : "sources"} user=${u} roles=${s.eff.roles.join(",")} sep=${domainSeparation}`;
            expect(read, `read ${label}`).toEqual(rows.filter((row) => canReadRow(s, def, row, extra(row))).map((x) => String(x.id)).sort());
            // readers and participants never write
            const wp: unknown[] = [s.orgId];
            const write = await ids(`select t.id from ${def.table} t where t.org_id = $1 and ${writeSql(s, def, "t", wp)}`, wp);
            expect(write, `write ${label}`).toEqual(rows.filter((row) => writeMode(s, def, row) !== null).map((x) => String(x.id)).sort());
            if (grantIn(s.eff, def.area).read === "none") {
              none++;
              viaGrant += read.length;
              // without an area grant, only the rows the grant source names
              for (const id of read) expect(granted.get(u)!.has(id) || boundedGranted.get(u)!.has(id), `grant only ${label}`).toBe(true);
            }
          }
        }
      }
      // the organisations exercise the participant grant
      expect(none).toBeGreaterThan(0);
      expect(viaGrant).toBeGreaterThan(0);
    });
  }

  it("a readers field reads, never writes, and passes the confidentiality rule", async () => {
    const { org, users, roles } = await generate(91);
    const snap = await loadOrgSnapshot(db, org);
    const [row] = await db.query<Record<string, unknown>>(`select * from ${TICKET.table} where org_id = $1 order by no limit 1`, [org]);
    const plain = { ...row, confidential: true, caller_id: null, requested_for: null, opened_by: null, assigned_to: null, watch_list: [], access_list: [], assignment_group_id: null, resolved_by: null };
    let checked = 0;
    for (const [i, u] of users.entries()) {
      const { subject } = buildSubject(snap, { domainSeparation: false, preset: "need_to_know" }, org, u, roles[i], null);
      if (grantIn(subject.eff, "incident").read === "none" || canReadRow(subject, READERS, plain)) continue;
      const named = { ...plain, resolved_by: u };
      expect(canReadRow(subject, READERS, named)).toBe(true);
      expect(writeMode(subject, READERS, named)).toBe(writeMode(subject, READERS, plain));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
