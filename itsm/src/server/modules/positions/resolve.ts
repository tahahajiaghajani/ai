// Assignee resolution (design F §3.4): the people a workflow step goes to when it opens, and the designer's preview
// for a sample requester — one function for both (`resolveAssignees`), so a preview never promises what the runtime
// would not do.
//   1. Each rule finds people: the holders of a position valid on the day (in the organisation's time zone) — anywhere,
//      in the requester's unit, in the nearest unit (of a kind) up the tree that has a holder, in a fixed unit or in
//      the unit a form field names, narrowed to `members` when set; the members and leads of a group (valid now); the
//      holders of an access role (as the access model reads a member's roles: any role containing it, on the profile or
//      through a group, or the membership's fallback role); named people; the requester's (or the previous
//      actor's) manager to depth 3; the head of a unit; a person field of the case; whoever did an earlier step; the
//      requester. Rules are united, first rule first.
//   2. Only active members stay, and the excluded ones go (the requester — filer and beneficiary — on approve steps by
//      default: separation of duties; earlier actors; a step's actors). The organisation's own work — a case that is not
//      a row of its demo pack — never goes to the pack's people, nor to them as delegates (docs/DEMO_FA.md: demo accounts
//      approve no real record, as sla/approvals.ts `resolveLevel` keeps for records' approvals).
//   3. Delegation by action: approve reads a `delegation` row in force with scope «approvals», fill and review one with
//      scope «assignments»; without one, the out-of-office delegate of the member profile. A delegate who is active and
//      not excluded replaces the person (`delegatedFrom` keeps who it was for), up to three steps, never in a circle.
//      Each person found keeps their own place: a delegate of two people stands in twice (once for each), and a
//      candidate who is another's delegate is there for themselves and for the other.
//   4. Nobody left: the fallback rules, then `ifNobody` (wait, skip, or the process managers — resolved the same way).
//   5. Pools are capped: more than 100 people (50 approvers of an approve step whose quorum counts everyone) and the
//      step waits for the process managers to choose; the first 500 candidates come back for them.
// Reads only, through `q` (inside the caller's transaction when it opens a step), as the system: a resolution decides
// who receives work, never what the caller may read — the preview route checks its caller first.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { orgTz } from "../../engine";
import { localDate } from "@shared/model/jalali-buckets";
import { UNIT_KINDS } from "@shared/tables/access";
import {
  cleanStepAssignees, delegationScope, exclusionsOf, ifNobodyOf, isUuid, nobodyMessage, poolLimit, tooManyMessage, MAX_UNIT_DEPTH,
  type AssigneeKind, type AssigneeRule, type Exclusion, type IfNobody, type Quorum, type StepAction, type StepAssignees,
} from "@shared/process/assignees";
import { activeDelegations, managerOf, type Delegation } from "../sla/approvals";
import { MEMBERSHIP_FALLBACK, roleClosure, type RoleDef } from "@shared/access";
import { accessSettings, catalogOf, snapshotFor } from "../../access/subject";
import { demoPeople, isDemoRow } from "../../db/scope";

/** A person of the demo pack picked for a step of the organisation's own case (`reassignStep`). */
export const DEMO_PEOPLE_REAL_WORK = "حساب‌های نمایشی کار پرونده‌های واقعی سازمان را بر عهده نمی‌گیرند";

export interface ResolveInput {
  step: StepAssignees;
  action: StepAction;
  quorum?: Quorum | null;
  /** the step's label (messages) */
  label?: string | null;
  /** who filed the case: the `requester` rule; excluded with `requester` */
  requestedBy: string | null;
  /** whom the case is for (default: requestedBy): their unit and manager; excluded with `requester` */
  requestedFor?: string | null;
  /** the requester's unit as the case recorded it (default: their profile's unit now) */
  requesterUnit?: string | null;
  /** the case's values (`unit_field`, `field` rules) */
  values?: Record<string, unknown>;
  /** storage types of the case's fields (user, users, group; a unit field is a ref) — from the version snapshot */
  fieldTypes?: Record<string, string>;
  /** who did each earlier step (`step_actor` rules, the `earlier_actors` and `step:` exclusions) */
  stepActors?: Record<string, string[]>;
  /** whoever acted last (`manager` of `previous_actor`) */
  previousActor?: string | null;
  /** the process managers, for `ifNobody: "managers"` */
  managers?: string[];
  managerGroups?: string[];
  /** the moment of resolution (holders' validity, delegations); default now */
  at?: number;
  /**
   * The workflow case the step belongs to: unless it is a row of the organisation's demo pack (sm_demo_rows), the step
   * is the organisation's own work and the pack's people are neither found nor stand in as delegates.
   */
  caseId?: string | null;
  /** The same decided by the caller (the designer's preview, which has no case): true — the organisation's own work. */
  real?: boolean;
}

export interface Via {
  /** the rule's index in its list (-1: the process managers) */
  rule: number;
  kind: AssigneeKind | "managers";
  fallback?: true;
  /** position rules: the position's key, the holder's unit and kind */
  position?: string;
  unit?: string | null;
  holderKind?: string;
  group?: string;
}

export interface Resolved {
  user: string;
  /** the person the delegate stands in for */
  delegatedFrom: string | null;
  via: Via;
}

export interface ResolveResult {
  /** ok: `people` are the step's people; managers: nobody was found and the process managers are; nobody; too_many */
  status: "ok" | "managers" | "nobody" | "too_many";
  people: Resolved[];
  /** people found (after exclusions and delegation), before the limit */
  found: number;
  limit: number;
  fallbackUsed: boolean;
  ifNobody: IfNobody;
  /** too_many: the first 500 people found, for the process managers to choose from */
  candidates?: string[];
  /** why rules found nobody (Persian): an inactive position, a requester without a unit, a vacant post… */
  notes: string[];
  /** the message of «nobody» and «too_many» (Persian) */
  message: string | null;
}

const CANDIDATES = 500;
const lower = (v: unknown): string | null => (isUuid(v) ? v.toLowerCase() : null);
const kindLabel = (k: unknown) => UNIT_KINDS.find((o) => o.value === k)?.label ?? "واحد";

interface PositionRow {
  id: string;
  key: string;
  name: string;
  unit_kind: string | null;
  active: boolean;
}

interface UnitRow {
  id: string;
  name: string;
  kind: string | null;
  manager_id: string | null;
  parent_id: string | null;
  path: string | null;
  active: boolean;
}

interface HolderRow {
  user_id: string;
  org_unit_id: string | null;
  kind: string;
}

interface Found {
  user: string;
  via: Via;
}

/**
 * One resolution: its inputs, the day, and the rows it read (each read once). The estimate of the designer reads
 * positions, holders, groups and roles through it too.
 */
export class Resolution {
  readonly org: string;
  readonly at: number;
  readonly date: string;
  readonly notes: string[] = [];
  private positions = new Map<string, PositionRow | null>();
  private units = new Map<string, UnitRow | null>();
  private requesterUnitId: string | null | undefined;
  private delegation: { rows: Delegation[]; away: Map<string, string> } | null = null;
  private catalog: Map<string, RoleDef> | null = null;
  private realWork: Promise<boolean> | null = null;

  readonly ctx: Ctx;

  constructor(
    readonly q: Queryable,
    ctx: Ctx,
    readonly input: ResolveInput,
  ) {
    this.ctx = systemOf(ctx);
    this.org = ctx.org.id;
    this.at = input.at ?? Date.now();
    this.date = localDate(this.at, orgTz(ctx));
  }

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes.push(text);
  }

  /** The person the case is about: requestedFor, else requestedBy. */
  get subject(): string | null {
    return lower(this.input.requestedFor) ?? lower(this.input.requestedBy);
  }

  /**
   * Is the step the organisation's own work (see `ResolveInput.caseId`)? The caller's word, else its case's: a case that
   * is not a row of the demo pack. No case and no word (an estimate, a starters check): not judged.
   */
  isReal(): Promise<boolean> {
    if (typeof this.input.real === "boolean") return Promise.resolve(this.input.real);
    const id = lower(this.input.caseId);
    return (this.realWork ??= id ? isDemoRow(this.q, this.org, id).then((demo) => !demo) : Promise.resolve(false));
  }

  async position(ref: string): Promise<PositionRow | null> {
    if (this.positions.has(ref)) return this.positions.get(ref)!;
    const row = await this.q.one<PositionRow>(
      `select id, key, name, unit_kind, active from sm_positions where org_id = $1 and deleted_at is null and (key = $2 or id::text = lower($2)) limit 1`,
      [this.org, ref],
    );
    this.positions.set(ref, row);
    return row;
  }

  async unit(id: string): Promise<UnitRow | null> {
    if (this.units.has(id)) return this.units.get(id)!;
    const row = await this.q.one<UnitRow>(`select id, name, kind, manager_id, parent_id, path, active from sm_org_units where org_id = $1 and id = $2 and deleted_at is null`, [this.org, id]);
    this.units.set(id, row);
    return row;
  }

  /** A unit and the units above it, nearest first (from its materialised path; its parents when the path is missing). */
  async chain(id: string): Promise<UnitRow[]> {
    const start = await this.unit(id);
    if (!start) return [];
    const ids = (start.path ?? "").split("/").filter(isUuid).map((x) => x.toLowerCase());
    if (ids.length && ids[ids.length - 1] === start.id.toLowerCase()) {
      const rows = await this.q.query<UnitRow>(
        `select id, name, kind, manager_id, parent_id, path, active from sm_org_units where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
        [this.org, pgArray(ids.slice(-MAX_UNIT_DEPTH))],
      );
      const byId = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
      for (const r of rows) this.units.set(r.id, r);
      return ids.reverse().map((x) => byId.get(x)).filter((r): r is UnitRow => !!r);
    }
    const out: UnitRow[] = [start];
    let at = start;
    for (let i = 0; at.parent_id && i < MAX_UNIT_DEPTH; i++) {
      const up = await this.unit(at.parent_id);
      if (!up || out.some((u) => u.id === up.id)) break;
      out.push(up);
      at = up;
    }
    return out;
  }

  /** The requester's unit: as the case recorded it, else their profile's unit now. */
  async requesterUnit(): Promise<string | null> {
    if (this.requesterUnitId !== undefined) return this.requesterUnitId;
    let unit = lower(this.input.requesterUnit);
    if (!unit && this.subject) {
      const p = await this.q.one<{ org_unit_id: string | null }>(`select org_unit_id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [this.org, this.subject]);
      unit = lower(p?.org_unit_id);
    }
    this.requesterUnitId = unit;
    return unit;
  }

  /** Holders of a position valid on the day, in `units` when given. */
  async holders(positionId: string, units: string[] | null): Promise<HolderRow[]> {
    if (units && !units.length) return [];
    const params: unknown[] = [this.org, positionId, this.date];
    let where = "";
    if (units) {
      params.push(pgArray(units));
      where = ` and org_unit_id = any($4::uuid[])`;
    }
    return this.q.query<HolderRow>(
      `select user_id, org_unit_id, kind from sm_position_holders
       where org_id = $1 and position_id = $2 and deleted_at is null
         and (valid_from is null or valid_from <= $3::date) and (valid_to is null or valid_to >= $3::date)${where}
       order by user_id, org_unit_id`,
      params,
    );
  }

  /** Members (and leads, or leads only) of active groups, valid now. */
  async groupPeople(groups: string[], leadsOnly = false): Promise<{ user: string; group: string }[]> {
    const ids = [...new Set(groups.map(lower).filter((x): x is string => !!x))];
    if (!ids.length) return [];
    const live = await this.q.query<{ id: string; name: string; active: boolean | null }>(`select id, name, active from sm_groups where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [this.org, pgArray(ids)]);
    for (const g of live) if (g.active === false) this.note(`گروه «${g.name}» غیرفعال است`);
    const active = live.filter((g) => g.active !== false).map((g) => g.id);
    if (live.length < ids.length) this.note("گروهی که قاعده نام برده پیدا نشد");
    if (!active.length) return [];
    const rows = await this.q.query<{ user_id: string; group_id: string }>(
      `select user_id, group_id from sm_group_members
       where org_id = $1 and group_id = any($2::uuid[]) and deleted_at is null and kind = any($3::text[])
         and (valid_from is null or valid_from <= $4::timestamptz) and (valid_to is null or valid_to > $4::timestamptz)
       order by user_id`,
      [this.org, pgArray(active), pgArray(leadsOnly ? ["lead"] : ["member", "lead"]), new Date(this.at).toISOString()],
    );
    return rows.map((r) => ({ user: r.user_id, group: r.group_id }));
  }

  /**
   * Holders of an access role as the access model reads a member's roles (`composeEffective`): whoever holds a role
   * whose closure contains it — on their profile or through an active group's roles (not as observers); owners and
   * «مدیر» members when tenant_admin's does; members without roles of their own when their membership's fallback role's
   * does (member → agent, viewer → auditor). An unknown or inactive role is held by nobody.
   */
  async rolePeople(role: string): Promise<string[]> {
    this.catalog ??= catalogOf(await snapshotFor(this.ctx, this.q), accessSettings(this.ctx.org));
    const catalog = this.catalog;
    const holding = [...catalog.values()].filter((r) => r.active !== false && roleClosure([r.key], catalog).includes(role)).map((r) => r.key).sort();
    if (!holding.length) return [];
    const at = new Date(this.at).toISOString();
    const profiles = await this.q.query<{ user_id: string }>(`select user_id from sm_member_profiles where org_id = $1 and deleted_at is null and roles ?| $2::text[] order by user_id`, [this.org, pgArray(holding)]);
    const groups = await this.q.query<{ id: string }>(`select id from sm_groups where org_id = $1 and deleted_at is null and active is not false and roles ?| $2::text[]`, [this.org, pgArray(holding)]);
    const viaGroups = groups.length
      ? await this.q.query<{ user_id: string }>(
          `select user_id from sm_group_members
           where org_id = $1 and group_id = any($2::uuid[]) and deleted_at is null and kind <> 'observer'
             and (valid_from is null or valid_from <= $3::timestamptz) and (valid_to is null or valid_to > $3::timestamptz)`,
          [this.org, pgArray(groups.map((g) => g.id)), at],
        )
      : [];
    const admins = holding.includes("tenant_admin")
      ? await this.q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active and role in ('owner', 'admin')`, [this.org])
      : [];
    // members with no role of their own (no profile role nor a role of an active group they are in, as the catalogue
    // knows roles) work as their membership's fallback role
    const fallback = (["member", "viewer"] as const).filter((m) => holding.includes(MEMBERSHIP_FALLBACK[m]));
    const keys = pgArray([...catalog.keys()]);
    const legacy = fallback.length
      ? await this.q.query<{ user_id: string }>(
          `select m.user_id from sm_org_members m
           left join sm_member_profiles p on p.org_id = m.org_id and p.user_id = m.user_id and p.deleted_at is null
           where m.org_id = $1 and m.deleted_at is null and m.is_active and m.role = any($2::text[]) and not coalesce(p.roles ?| $3::text[], false)
             and not exists (
               select 1 from sm_group_members gm join sm_groups g on g.id = gm.group_id and g.org_id = gm.org_id and g.deleted_at is null and g.active is not false
               where gm.org_id = m.org_id and gm.user_id = m.user_id and gm.deleted_at is null and gm.kind <> 'observer' and g.roles ?| $3::text[]
                 and (gm.valid_from is null or gm.valid_from <= $4::timestamptz) and (gm.valid_to is null or gm.valid_to > $4::timestamptz))`,
          [this.org, pgArray(fallback), keys, at],
        )
      : [];
    return [...new Set([...profiles, ...viaGroups, ...admins, ...legacy].map((r) => r.user_id.toLowerCase()))].sort();
  }

  /** Of `ids`, the active members of the organisation. */
  async activeOf(ids: string[]): Promise<Set<string>> {
    const clean = [...new Set(ids.map(lower).filter((x): x is string => !!x))];
    if (!clean.length) return new Set();
    const rows = await this.q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [this.org, pgArray(clean)]);
    return new Set(rows.map((r) => r.user_id.toLowerCase()));
  }

  /** Who acts for `user` in this action: a delegation row of its scope, else the out-of-office delegate; up to three steps. */
  async delegateOf(user: string): Promise<string> {
    if (!this.delegation) {
      const rows = await activeDelegations(this.q, this.ctx, delegationScope(this.input.action), this.at);
      const away = await this.q.query<{ user_id: string; delegate_id: string; ooo_until: string | Date | null }>(
        `select user_id, delegate_id, ooo_until from sm_member_profiles where org_id = $1 and deleted_at is null and out_of_office and delegate_id is not null`,
        [this.org],
      );
      const map = new Map<string, string>();
      for (const p of away) {
        if (p.ooo_until && new Date(p.ooo_until).getTime() <= this.at) continue;
        if (String(p.delegate_id).toLowerCase() !== String(p.user_id).toLowerCase()) map.set(String(p.user_id).toLowerCase(), String(p.delegate_id).toLowerCase());
      }
      this.delegation = { rows: rows.map((d) => ({ from: d.from.toLowerCase(), to: d.to.toLowerCase() })), away: map };
    }
    const { rows, away } = this.delegation;
    let at = user;
    const seen = new Set([user]);
    for (let i = 0; i < 3; i++) {
      const next = rows.find((d) => d.from === at)?.to ?? away.get(at);
      if (!next || seen.has(next)) break;
      seen.add(next);
      at = next;
    }
    return at;
  }

  // ----- the rules ---------------------------------------------------------------------------------------------

  async rule(rule: AssigneeRule, index: number, fallback: boolean): Promise<Found[]> {
    const via = (extra: Partial<Via> = {}): Via => ({ rule: index, kind: rule.kind, ...(fallback ? { fallback: true as const } : {}), ...extra });
    const people = (users: (string | null | undefined)[], extra: Partial<Via> = {}): Found[] =>
      users.map(lower).filter((u): u is string => !!u).map((user) => ({ user, via: via(extra) }));
    const values = this.input.values ?? {};
    switch (rule.kind) {
      case "position":
        return this.positionRule(rule, via);
      case "group": {
        let found = await this.groupPeople([rule.group], rule.leadsOnly);
        if (rule.members?.length) found = found.filter((f) => rule.members!.includes(f.user.toLowerCase()));
        return found.map((f) => ({ user: f.user.toLowerCase(), via: via({ group: f.group }) }));
      }
      case "role": {
        let found = await this.rolePeople(rule.role);
        if (rule.members?.length) found = found.filter((u) => rule.members!.includes(u));
        if (!found.length) this.note(`کسی نقش دسترسی «${rule.role}» را ندارد`);
        return people(found);
      }
      case "users":
        return people(rule.users);
      case "manager": {
        // a draft's wrong value (the publish check refuses it) finds nobody, never somebody else's manager
        if ((rule.of !== "requester" && rule.of !== "previous_actor") || (rule.depth !== undefined && ![1, 2, 3].includes(rule.depth))) {
          this.note("قاعدهٔ «مدیر مستقیم» معتبر نیست");
          return [];
        }
        const who = rule.of === "previous_actor" ? lower(this.input.previousActor) : this.subject;
        if (!who) {
          this.note(rule.of === "previous_actor" ? "هنوز کسی مرحله‌ای را انجام نداده است" : "درخواست‌دهنده معلوم نیست");
          return [];
        }
        const m = await managerOf(this.q, this.ctx, who, rule.depth ?? 1);
        if (!m) this.note(rule.of === "previous_actor" ? "انجام‌دهندهٔ قبلی مدیر ندارد" : "درخواست‌دهنده مدیر مستقیم ندارد");
        return people([m]);
      }
      case "unit_head": {
        if (rule.of !== "requester" && rule.of !== "unit_field") {
          this.note("قاعدهٔ «رئیس واحد» معتبر نیست");
          return [];
        }
        const start = rule.of === "unit_field" ? lower(rule.unitField ? values[rule.unitField] : null) : await this.requesterUnit();
        if (!start) {
          this.note(rule.of === "unit_field" ? "فیلد واحد خالی است" : "درخواست‌دهنده واحد سازمانی ندارد");
          return [];
        }
        const chain = await this.chain(start);
        const target = rule.unitKind ? chain.find((u) => u.kind === rule.unitKind && u.active !== false) : chain[0];
        if (!target) {
          this.note(`واحدی از نوع «${kindLabel(rule.unitKind)}» در بالادست پیدا نشد`);
          return [];
        }
        if (!target.manager_id) this.note(`«${target.name}» رئیس ندارد`);
        return people([target.manager_id], { unit: target.id });
      }
      case "field": {
        const v = values[rule.field];
        const type = this.input.fieldTypes?.[rule.field];
        if (type === "group") return (await this.groupPeople([String(v ?? "")])).map((f) => ({ user: f.user.toLowerCase(), via: via({ group: f.group }) }));
        if (Array.isArray(v)) return people(v as string[]);
        return people([v as string]);
      }
      case "step_actor":
        return people(this.input.stepActors?.[rule.step] ?? []);
      case "requester":
        return people([this.input.requestedBy]);
      default:
        return [];
    }
  }

  private async positionRule(rule: Extract<AssigneeRule, { kind: "position" }>, via: (extra?: Partial<Via>) => Via): Promise<Found[]> {
    const pos = await this.position(rule.position);
    if (!pos) {
      this.note(`نقش سازمانی «${rule.position}» پیدا نشد`);
      return [];
    }
    if (pos.active === false) {
      this.note(`نقش سازمانی «${pos.name}» غیرفعال است`);
      return [];
    }
    let holders: HolderRow[] = [];
    const values = this.input.values ?? {};
    switch (rule.where) {
      case "anywhere":
        holders = await this.holders(pos.id, null);
        if (!holders.length) this.note(`کسی «${pos.name}» نیست`);
        break;
      case "requester_unit":
      case "requester_unit_up": {
        const unit = await this.requesterUnit();
        if (!unit) {
          this.note("درخواست‌دهنده واحد سازمانی ندارد");
          return [];
        }
        if (rule.where === "requester_unit") {
          holders = await this.holders(pos.id, [unit]);
          if (!holders.length) this.note(`«${pos.name}» در «${(await this.unit(unit))?.name ?? ""}» دارنده‌ای ندارد`);
          break;
        }
        // the nearest unit (of the kind) up the tree from the requester's that has a holder
        const kind = rule.unitKind ?? null;
        const chain = (await this.chain(unit)).filter((u) => u.active !== false && (!kind || u.kind === kind));
        const all = await this.holders(pos.id, chain.map((u) => u.id));
        const nearest = chain.find((u) => all.some((h) => h.org_unit_id?.toLowerCase() === u.id.toLowerCase()));
        holders = nearest ? all.filter((h) => h.org_unit_id?.toLowerCase() === nearest.id.toLowerCase()) : [];
        if (!nearest) this.note(kind ? `«${pos.name}» در واحدهای نوع «${kindLabel(kind)}» از واحد درخواست‌دهنده تا بالا دارنده‌ای ندارد` : `«${pos.name}» در واحد درخواست‌دهنده و واحدهای بالاتر دارنده‌ای ندارد`);
        break;
      }
      case "unit": {
        const unit = lower(rule.unit);
        holders = unit ? await this.holders(pos.id, [unit]) : [];
        if (!holders.length) this.note(`«${pos.name}» در واحد برگزیده دارنده‌ای ندارد`);
        break;
      }
      case "unit_field": {
        const unit = lower(rule.unitField ? values[rule.unitField] : null);
        if (!unit) {
          this.note("فیلد واحد خالی است");
          return [];
        }
        holders = await this.holders(pos.id, [unit]);
        if (!holders.length) this.note(`«${pos.name}» در «${(await this.unit(unit))?.name ?? ""}» دارنده‌ای ندارد`);
        break;
      }
      default:
        // a «where» the rules do not know (a draft's, refused at publish) is nobody — never «همه‌جا»
        this.note("محدودهٔ نقش سازمانی معتبر نیست");
        return [];
    }
    if (rule.members?.length) {
      const before = holders.length;
      holders = holders.filter((h) => rule.members!.includes(h.user_id.toLowerCase()));
      if (before && !holders.length) this.note(`افراد برگزیده در میان دارندگان «${pos.name}» نیستند`);
    }
    return holders.map((h) => ({ user: h.user_id.toLowerCase(), via: via({ position: pos.key, unit: h.org_unit_id, holderKind: h.kind }) }));
  }

  /** The people of `rules` (united, active, not excluded, delegated, deduplicated), first rule first. */
  async pool(rules: AssigneeRule[], fallback: boolean, excluded: Set<string>): Promise<Resolved[]> {
    const found: Found[] = [];
    for (const [i, r] of rules.entries()) found.push(...(await this.rule(r, i, fallback)));
    return this.settle(found, excluded);
  }

  async settle(found: Found[], excluded: Set<string>): Promise<Resolved[]> {
    const first = new Map<string, Found>();
    for (const f of found) if (!first.has(f.user)) first.set(f.user, f);
    if (!first.size) return [];
    const delegates = new Map<string, string>();
    for (const u of first.keys()) delegates.set(u, await this.delegateOf(u));
    const active = await this.activeOf([...first.keys(), ...delegates.values()]);
    // the organisation's own work never goes to the demo pack's people, found by any rule or standing in for someone
    // (whoever they stand in for keeps the place): a step left with nobody follows its «ifNobody»
    if (active.size && (await this.isReal())) for (const u of await demoPeople(this.q, this.org, [...active])) active.delete(u);
    // one place per person found: a delegate standing in for two people holds both places (each with its
    // delegatedFrom), and a candidate who is also another's delegate keeps their own place too
    const out: Resolved[] = [];
    for (const f of first.values()) {
      if (!active.has(f.user) || excluded.has(f.user)) continue;
      const d = delegates.get(f.user)!;
      const user = d !== f.user && active.has(d) && !excluded.has(d) ? d : f.user;
      out.push({ user, delegatedFrom: user !== f.user ? f.user : null, via: f.via });
    }
    return out;
  }

  /** The people a step never goes to. */
  excluded(list: Exclusion[]): Set<string> {
    const out = new Set<string>();
    const add = (v: unknown) => {
      const u = lower(v);
      if (u) out.add(u);
    };
    for (const x of list) {
      if (x === "requester") {
        add(this.input.requestedBy);
        add(this.input.requestedFor);
      } else if (x === "earlier_actors") {
        for (const users of Object.values(this.input.stepActors ?? {})) for (const u of users) add(u);
      } else if (x.startsWith("step:")) {
        for (const u of this.input.stepActors?.[x.slice(5)] ?? []) add(u);
      }
    }
    return out;
  }
}

/** The system inside `ctx`'s organisation (the approvals helpers read through it). */
function systemOf(ctx: Ctx): Ctx {
  return ctx.actor === "system" ? ctx : { ...ctx, actor: "system", can: () => true, need: () => undefined };
}

/** Resolve a step's people (see the header). Reads through `q`: pass the transaction that opens the step. */
export async function resolveAssignees(q: Queryable, ctx: Ctx, input: ResolveInput): Promise<ResolveResult> {
  const step = cleanStepAssignees(input.step);
  const run = new Resolution(q, ctx, input);
  const limit = poolLimit(input.action, input.quorum);
  const ifNobody = ifNobodyOf(step);
  const excluded = run.excluded(exclusionsOf(step, input.action));
  let status: ResolveResult["status"] = "ok";
  let fallbackUsed = false;
  let people = await run.pool(step.assignees, false, excluded);
  if (!people.length && step.fallback?.length) {
    fallbackUsed = true;
    people = await run.pool(step.fallback, true, excluded);
  }
  if (!people.length && ifNobody === "managers") {
    const managers: Found[] = [
      ...(input.managers ?? []).map(lower).filter((u): u is string => !!u).map((user) => ({ user, via: { rule: -1, kind: "managers" as const } })),
      ...(await run.groupPeople(input.managerGroups ?? [])).map((f) => ({ user: f.user.toLowerCase(), via: { rule: -1, kind: "managers" as const, group: f.group } })),
    ];
    people = await run.settle(managers, excluded);
    if (people.length) status = "managers";
    else run.note("مسئولی برای گردش‌کار تعیین نشده است");
  }
  const found = people.length;
  if (!found) {
    return { status: "nobody", people: [], found: 0, limit, fallbackUsed, ifNobody, notes: run.notes, message: nobodyMessage(input.label, ifNobody) };
  }
  if (found > limit) {
    return { status: "too_many", people: [], found, limit, fallbackUsed, ifNobody, candidates: [...new Set(people.map((p) => p.user))].slice(0, CANDIDATES), notes: run.notes, message: tooManyMessage(limit) };
  }
  return { status, people, found, limit, fallbackUsed, ifNobody, notes: run.notes, message: null };
}

/** The positions a person holds on the day (key and unit): the Windows app's and the diagram's static check (`mayInclude`). */
export async function heldPositions(q: Queryable, ctx: Ctx, userId: string, at = Date.now()): Promise<{ position: string; unit: string | null; kind: string }[]> {
  const date = localDate(at, orgTz(ctx));
  const rows = await q.query<{ key: string; org_unit_id: string | null; kind: string }>(
    `select p.key, h.org_unit_id, h.kind from sm_position_holders h join sm_positions p on p.id = h.position_id and p.org_id = h.org_id and p.deleted_at is null and p.active is not false
     where h.org_id = $1 and h.user_id = $2 and h.deleted_at is null
       and (h.valid_from is null or h.valid_from <= $3::date) and (h.valid_to is null or h.valid_to >= $3::date)
     order by p.key, h.org_unit_id`,
    [ctx.org.id, userId, date],
  );
  return rows.map((r) => ({ position: r.key, unit: r.org_unit_id, kind: r.kind }));
}
