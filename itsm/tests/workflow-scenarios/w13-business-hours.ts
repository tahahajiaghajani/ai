// W13 «پاسخ به نامهٔ مشتری» — business hours («به وقت کاری», a step's default): a step's deadline, its escalation and
// its reminders counted on the organisation's default business calendar as the SLA seed makes it for a new
// organisation (src/server/modules/sla/calendars.ts `seedCalendarsIn`: «ساعات اداری», Saturday–Wednesday 08:00–16:00,
// Thursday 08:00–12:00, Friday off, the official Iranian holidays of the bundled years) — the other scenarios'
// organisations have no calendar (only process.seed runs there) and count calendar time.
//
// The clock is pinned to the week of 1 Dey 1405 (a fake Date that keeps moving; PGlite's now() follows it, which a
// PostgreSQL server's does not: this scenario runs on the PGlite editions): Tuesday 1405-10-01 = 2026-12-22, Wednesday
// 1405-10-02 the official holiday «ولادت امام علی (ع) و روز پدر», Thursday's half day, Friday off. «پاسخ کارشناس» has
// «مهلت انجام» 8 hours with «پایان مهلت» wired to «پاسخ سرپرست», «یادآوری هر» 2 hours and «باخبر کردن مسئولان» after 5
// hours. Opened Tuesday 13:30:
//   - the deadline: Tuesday 13:30–16:00 (2.5 h), the holiday, Thursday 08:00–12:00 (4 h), Friday, Saturday 08:00–09:30
//     (1.5 h): Saturday 1405-10-05 09:30;
//   - the escalation: 2.5 h on Tuesday and 2.5 h on Thursday: Thursday 10:30;
//   - the reminders, two working hours apart: Tuesday 15:30, Thursday about 09:30 and 11:30, then the deadline itself.
// A second case opened Thursday 14:00, after the half day, counts from Saturday 08:00: reminders from 10:00, the
// escalation at 13:00, the deadline at 16:00.
// The timer runs at the moments below (the clock moved there, then the organisation's process.timer); the reminders
// a run sends are read per case from the expert's bells. BH1: the reminders count calendar time today
// (src/server/modules/process/timers/timer.ts, `remind_every` in roundTimersIn and roundNextAt), so the expert is
// reminded every two hours through the evening, the holiday and Friday; that test fails until they count working time.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { e, item, n, section, tab, world, type Draft, type EditionRef, type Scn } from "./harness";

export const W13 = { key: "aftab_letter_reply", name: "پاسخ به نامهٔ مشتری" };
const STEP = "پاسخ کارشناس";
const REMINDER = `یادآوری مرحله: «${STEP}»`;

/** A moment in Tehran (+03:30 all year: Iran keeps no daylight saving since 1402). */
export const T = (local: string): number => Date.parse(`${local}:00+03:30`);

export function w13Draft(s: Scn): Draft {
  const F = s.forms.lt;
  return {
    graph: {
      nodes: [
        n("start", "trigger"),
        n("request", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_aftab_lt_answer: "hidden" } } }, "ثبت نامه"),
        n("answer", "form_step", {
          action: "fill", form: F, rights: { default: "read", fields: { u_aftab_lt_answer: "required" } },
          assignees: [{ kind: "users", users: s.ids("expert") }],
          // «به وقت کاری» is the default: no `business: false`
          due: { amount: 8, unit: "hour" }, remind_every: { amount: 2, unit: "hour" },
          escalate: [{ after: { amount: 5, unit: "hour" }, action: "notify", to: "managers" }],
        }, STEP),
        n("lead", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_aftab_lt_answer: "required" } }, assignees: [{ kind: "users", users: s.ids("lead") }] }, "پاسخ سرپرست"),
        n("done", "end", { outcome: "completed" }, "پایان (پاسخ داده شد)"),
      ],
      edges: [e("start", "request"), e("request", "answer"), e("answer", "done"), e("answer", "lead", "timeout"), e("lead", "done")],
    },
    starters: [{ kind: "users", users: s.ids("clerk") }],
    title_template: "نامهٔ {{case.u_aftab_lt_customer}}",
    managers: s.ids("manager"),
  };
}

export async function setupW13(s: Scn): Promise<void> {
  await s.unit("hq", "بانک نمونهٔ آفتاب", "company");
  await s.unit("care", "ادارهٔ امور مشتریان", "department", "hq");
  // the organisation's own people
  await s.person("clerk", "کارمند دبیرخانه", { unit: "care" });
  await s.person("expert", "کارشناس پاسخگویی", { unit: "care" });
  await s.person("lead", "سرپرست پاسخگویی", { unit: "care" });
  await s.person("manager", "مدیر امور مشتریان", { unit: "care" });
  await s.field("u_aftab_lt_customer", "نام مشتری", "string");
  await s.field("u_aftab_lt_subject", "موضوع نامه", "text");
  await s.field("u_aftab_lt_answer", "پاسخ", "text");
  await s.form("lt", "فرم نامهٔ مشتری", [tab("نامه", [section(null, [item("u_aftab_lt_customer", { required: true }), item("u_aftab_lt_subject"), item("u_aftab_lt_answer")])])]);
}

export function w13(ref: EditionRef): void {
  describe("W13 «پاسخ به نامهٔ مشتری» (business hours on the SLA seed's calendar)", () => {
    let s: Scn;
    /** the expert's reminders of each case after each run of the timer */
    const seen: { at: string; c1: number; c2: number | null }[] = [];
    const cases: { c1: string; c2: string } = { c1: "", c2: "" };

    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: T("2026-12-22T09:00"), shouldAdvanceTime: true });
      s = await world(await ref.get());
      await setupW13(s);
      const pub = await s.publish(W13.key, W13.name, w13Draft(s));
      expect(pub.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
      // the SLA seed a new organisation gets ten minutes after it is created: its calendars and official holidays
      await s.timers(["sla.seed"]);
    }, 600_000);

    afterAll(() => {
      vi.useRealTimers();
    });

    const reminders = async (caseId: string): Promise<number> =>
      (await s.db.query(`select 1 from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3 and title = $4`, [s.org, s.id("expert"), caseId, REMINDER])).length;
    const escalations = async (caseId: string): Promise<string[]> => (await s.journal(caseId)).filter((l) => l.startsWith(`مهلت گذشت؛ «${STEP}» به`));
    /** The clock at `local` (Tehran), then the organisation's timer; what each case's expert has been reminded of. */
    const at = async (local: string): Promise<void> => {
      vi.setSystemTime(T(local));
      await s.timers();
      seen.push({ at: local, c1: await reminders(cases.c1), c2: cases.c2 ? await reminders(cases.c2) : null });
    };
    const start = async (local: string, customer: string): Promise<string> => {
      vi.setSystemTime(T(local));
      const r = await s.start("clerk", W13.key, { u_aftab_lt_customer: customer, u_aftab_lt_subject: "اعتراض به کارمزد" });
      await s.settle();
      expect(await s.openAt(r.case, "answer")).toEqual(["expert"]);
      return r.case;
    };
    const near = (iso: string | null, local: string) => expect(Math.abs(Date.parse(String(iso)) - T(local))).toBeLessThan(2 * 60_000);

    it("the deadline and the escalation count working time: past the holiday, Thursday's half day and Friday; «پایان مهلت» only then; a step opened after Thursday's half day counts from Saturday", async () => {
      // the seed's default calendar and the bundled official holiday of 2 Dey 1405
      expect(await s.db.one(`select name from sm_calendars where org_id = $1 and is_default and deleted_at is null`, [s.org])).toEqual({ name: "ساعات اداری" });
      expect(await s.db.one(`select title from sm_holidays where org_id = $1 and date = '2026-12-23' and deleted_at is null`, [s.org])).toEqual({ title: "ولادت امام علی (ع) و روز پدر" });
      // PGlite's clock is the pinned one
      const dbNow = Number((await s.db.one<{ ms: number }>(`select (extract(epoch from now()) * 1000)::float8 as ms`))!.ms);
      expect(Math.abs(dbNow - Date.now())).toBeLessThan(60_000);
      expect(dbNow).toBeGreaterThan(T("2026-12-22T09:00"));

      cases.c1 = await start("2026-12-22T13:30", "شرکت نمونهٔ یکم");
      const c1 = cases.c1;
      const task = async (c: string, step = "answer") => (await s.tasks(c)).find((t) => t.step_key === step)!;
      // Tuesday 2.5 h + Thursday 4 h + Saturday 1.5 h
      near((await task(c1)).due_at, "2026-12-26T09:30");
      const inbox = (await s.as("expert").get(`${s.P}/process/inbox`)).rows.find((r: { case_id: string }) => r.case_id === c1);
      near(inbox.due_at, "2026-12-26T09:30");

      for (const m of ["2026-12-22T15:31", "2026-12-22T19:00", "2026-12-23T11:00", "2026-12-24T08:30", "2026-12-24T09:33"]) {
        await at(m);
        expect({ m, escalations: await escalations(c1) }).toEqual({ m, escalations: [] });
      }
      // Thursday 10:30: 2.5 working hours on Tuesday and 2.5 on Thursday — the managers are told, once
      await at("2026-12-24T10:32");
      expect(await escalations(c1)).toEqual([`مهلت گذشت؛ «${STEP}» به مدیر امور مشتریان اطلاع داده شد`]);
      const k1 = await s.kase(c1);
      expect((await s.bells("manager")).filter((t) => t === `مهلت گذشت: «${STEP}» در پروندهٔ ${k1.number}`)).toHaveLength(1);
      await at("2026-12-24T11:35");

      // a second case, opened after Thursday's half day: its time starts on Saturday 08:00
      cases.c2 = await start("2026-12-24T14:00", "شرکت نمونهٔ دوم");
      const c2 = cases.c2;
      near((await task(c2)).due_at, "2026-12-26T16:00");
      for (const m of ["2026-12-24T14:01", "2026-12-25T11:00", "2026-12-26T08:30"]) {
        await at(m);
        expect({ m, c1: await s.openAt(c1, "answer"), c2: await escalations(c2) }).toEqual({ m, c1: ["expert"], c2: [] });
      }
      expect(await escalations(c1)).toHaveLength(1);

      // Saturday 09:30: the first case's deadline — «پایان مهلت» takes it to the supervisor
      await at("2026-12-26T09:31");
      expect(await s.at(c1, "answer")).toEqual(["expert:not_needed"]);
      expect(await s.openAt(c1, "lead")).toEqual(["lead"]);
      expect(await s.journal(c1)).toContain(`مهلت «${STEP}» به پایان رسید؛ پرونده از مسیر «پایان مهلت» ادامه یافت`);
      expect((await s.path(c1)).slice(0, 3)).toEqual(["start:out", "request:out", "answer:timeout"]);
      await s.submit("lead", c1, "lead", { values: { u_aftab_lt_answer: "کارمزد بازگردانده شد" } });
      await s.settle();
      expect(await s.kase(c1)).toMatchObject({ state: "completed", outcome: "completed", data: { u_aftab_lt_answer: "کارمزد بازگردانده شد" } });

      // the second case: told at 13:00 (5 working hours from Saturday 08:00), still open at 15:59, due at 16:00
      await at("2026-12-26T10:01");
      expect(await escalations(c2)).toEqual([]);
      await at("2026-12-26T13:01");
      expect(await escalations(c2)).toHaveLength(1);
      await at("2026-12-26T15:59");
      expect(await s.openAt(c2, "answer")).toEqual(["expert"]);
      await at("2026-12-26T16:01");
      expect(await s.openAt(c2, "lead")).toEqual(["lead"]);
      expect(await s.at(c2, "answer")).toEqual(["expert:not_needed"]);
      await s.submit("lead", c2, "lead", { values: { u_aftab_lt_answer: "پاسخ داده شد" } });
      await s.settle();
      expect(await s.kase(c2)).toMatchObject({ state: "completed" });
    }, 600_000);

    it("(BH1) the reminders of a «به وقت کاری» step fall two working hours apart: none in the evening, on the holiday, on Thursday afternoon or on Friday", () => {
      // the first case (opened Tuesday 13:30): Tuesday 15:30, Thursday about 09:30 and 11:30, then the deadline itself;
      // the second (opened Thursday 14:00): Saturday 10:00, about 12:00 and 14:00
      const c1 = seen.filter((x) => x.at <= "2026-12-26T09:31").map((x) => [x.at, x.c1]);
      const c2 = seen.filter((x) => x.c2 !== null).map((x) => [x.at, x.c2]);
      expect({ c1, c2 }).toEqual({
        c1: [
          ["2026-12-22T15:31", 1], ["2026-12-22T19:00", 1], ["2026-12-23T11:00", 1], ["2026-12-24T08:30", 1], ["2026-12-24T09:33", 2],
          ["2026-12-24T10:32", 2], ["2026-12-24T11:35", 3], ["2026-12-24T14:01", 3], ["2026-12-25T11:00", 3], ["2026-12-26T08:30", 3], ["2026-12-26T09:31", 3],
        ],
        c2: [
          ["2026-12-24T14:01", 0], ["2026-12-25T11:00", 0], ["2026-12-26T08:30", 0], ["2026-12-26T09:31", 0], ["2026-12-26T10:01", 1],
          ["2026-12-26T13:01", 2], ["2026-12-26T15:59", 3], ["2026-12-26T16:01", 3],
        ],
      });
    });
  });
}
