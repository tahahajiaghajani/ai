// The pure model of service requests (src/shared/request): order forms (policies, checks in every channel, grids,
// prices, titles, cascades, guide rules, policy problems), audiences (any/all, denial wins, trees), delivery
// promises on the working calendar and statistical expectations, and the lifecycle (stages, the order's roll-up, task
// dependencies and outcomes, cancel policies, titles, people of a line, close codes).
import { describe, it, expect } from "vitest";
import {
  answerText, cascade, checkAnswers, defaultAnswers, formDef, formState, guideIncludes, policyProblem, priceOf, titleOf, type FormSchema, type VarDef,
} from "@shared/request/form";
import { allows, audienceMatches, audienceOf, entitled, pathUp, type MemberFacts } from "@shared/request/audience";
import { percentile, promiseText, sle, sleText, workingDaysDue } from "@shared/request/due";
import {
  answersEditable, cancelRefusal, closeCodeFor, linePeople, orderTitle, readyTasks, rollupRequest, stageFor, stageIndex, tasksOutcome,
} from "@shared/request/logic";
import { calendarOf, DEFAULT_HOURS } from "@shared/sla/calendar";

const v = (name: string, type: VarDef["type"], extra: Partial<VarDef> = {}): VarDef => ({ name, label: extra.label ?? name, type, order: extra.order ?? 10, ...extra });

const laptop: FormSchema = {
  v: 1,
  item: { id: "i1", number: "ITM00001", name: "لپ‌تاپ", code: "laptop", type: "hardware", catalog_id: "c1", category_id: null, price: "1000", recurring_price: "50", recurring_frequency: "monthly", title_template: "لپ‌تاپ {{model}} برای {{requested_for}} — {{quantity}} عدد" },
  sections: [{ key: "delivery", label: "تحویل" }],
  variables: [
    v("model", "select", { required: true, choices: [{ value: "std", label: "استاندارد" }, { value: "pro", label: "حرفه‌ای", price: "500" }] }),
    v("extras", "multiselect", { choices: [{ value: "bag", label: "کیف", price: "20" }, { value: "mouse", label: "ماوس", price: "5" }] }),
    v("ram_gb", "int", { min: 8, max: 64, price_per_unit: "10" }),
    v("replace", "bool"),
    v("old_asset", "string", { hidden: true, regex: "^IT-[0-9]+$", regex_message: "شمارهٔ اموال با IT- آغاز می‌شود" }),
    v("note", "text", { max_length: 10 }),
    v("pin", "secret", { field_class: "secret" }),
    v("address", "string", { section: "delivery", required: true }),
    v("title", "label"),
  ],
  grids: [{ code: "users", label: "کاربران", min_rows: 1, max_rows: 2, columns: [v("full_name", "string", { required: true }), v("email", "email")] }],
  policies: [
    { name: "replace", when: { f: "replace", op: "eq", v: true }, actions: [{ variable: "old_asset", visible: true, mandatory: true }], applies_to: "both", order: 10, message: "دستگاه قبلی را تحویل دهید" },
    { name: "pro-note", when: { f: "model", op: "eq", v: "pro" }, actions: [{ variable: "note", readonly: true }], applies_to: "fulfil", order: 20 },
    { name: "grid-email", when: { f: "full_name", op: "nempty" }, actions: [{ variable: "email", mandatory: true }], applies_to: "both", order: 30, grid: "users" },
  ],
  tasks: [],
};

describe("order forms", () => {
  it("builds a virtual table of the questions (labels and attachments excluded, grids as json)", () => {
    const def = formDef(laptop);
    expect(def.virtual).toBe(true);
    expect(def.fields.map((f) => f.name)).toEqual(["model", "extras", "ram_gb", "replace", "old_asset", "note", "pin", "address", "users"]);
    expect(def.fields.find((f) => f.name === "model")?.choices?.map((c) => c.value)).toEqual(["std", "pro"]);
    expect(def.fields.find((f) => f.name === "pin")?.type).toBe("secret");
  });

  it("applies policies live: shown, mandatory, read-only by mode, messages", () => {
    const off = formState(laptop, { replace: false }, { mode: "order" });
    expect(off.hidden.has("old_asset")).toBe(true);
    const on = formState(laptop, { replace: true }, { mode: "order" });
    expect(on.hidden.has("old_asset")).toBe(false);
    expect(on.required.has("old_asset")).toBe(true);
    expect(on.messages.map((m) => m.text)).toEqual(["دستگاه قبلی را تحویل دهید"]);
    expect(formState(laptop, { model: "pro" }, { mode: "order" }).readonly.has("note")).toBe(false);
    expect(formState(laptop, { model: "pro" }, { mode: "fulfil" }).readonly.has("note")).toBe(true);
    expect(formState(laptop, {}, { mode: "order" }).required.has("users")).toBe(true); // min_rows 1
  });

  it("checks answers: required, options, ranges, patterns, lengths, grids; drops hidden and unknown answers", () => {
    const r = checkAnswers(laptop, { model: "x", ram_gb: 4, note: "خیلی طولانی‌تر از ده", old_asset: "IT-1", unknown: 1, users: [] }, { mode: "order" });
    expect(Object.keys(r.errors).sort()).toEqual(["address", "model", "note", "ram_gb", "users"]);
    expect(r.answers.old_asset).toBeUndefined();
    expect(r.answers.unknown).toBeUndefined();
    const ok = checkAnswers(laptop, { model: "pro", extras: ["bag"], ram_gb: 16, replace: true, old_asset: "IT-77", address: "طبقهٔ ۲", users: [{ full_name: "علی", email: "ali@example.com" }, {}] }, { mode: "order" });
    expect(ok.errors).toEqual({});
    expect(ok.answers.users).toEqual([{ full_name: "علی", email: "ali@example.com" }]); // empty rows dropped
    const pattern = checkAnswers(laptop, { model: "std", replace: true, old_asset: "123", address: "x", users: [{ full_name: "a", email: "a@b.c" }] }, { mode: "order" });
    expect(pattern.errors.old_asset).toBe("شمارهٔ اموال با IT- آغاز می‌شود");
  });

  it("checks grid rows with the set's policies per row and the row limits", () => {
    const r = checkAnswers(laptop, { model: "std", address: "x", users: [{ full_name: "علی" }] }, { mode: "order" });
    expect(r.errors["users.0.email"]).toBeTruthy();
    const many = checkAnswers(laptop, { model: "std", address: "x", users: [{ full_name: "a", email: "a@a.a" }, { full_name: "b", email: "b@b.b" }, { full_name: "c", email: "c@c.c" }] }, { mode: "order" });
    expect(many.errors.users).toContain("حداکثر");
  });

  it("keeps a stored secret when the requester does not send it again", () => {
    const required = { ...laptop, variables: laptop.variables.map((x) => (x.name === "pin" ? { ...x, required: true } : x)) };
    const base = { model: "std", address: "x", users: [{ full_name: "a", email: "a@a.a" }] };
    expect(checkAnswers(required, base, { mode: "order" }).errors.pin).toBeTruthy();
    expect(checkAnswers(required, base, { mode: "order", secretsKept: new Set(["pin"]) }).errors.pin).toBeUndefined();
  });

  it("prices the answers exactly: options, per-unit questions, quantity and the recurring charge", () => {
    const p = priceOf(laptop, { model: "pro", extras: ["bag", "mouse"], ram_gb: 16 }, 3);
    expect(p.unit).toBe("1685"); // 1000 + 500 + 20 + 5 + 16 × 10
    expect(p.total).toBe("5055");
    expect(p.recurring).toBe("50");
    expect(p.recurring_total).toBe("150");
    expect(priceOf({ ...laptop, item: { ...laptop.item, price: null, recurring_price: "0" } }, {}).total).toBe("0");
  });

  it("titles requested items from the template, and shows answers as text", () => {
    expect(titleOf(laptop, { model: "pro" }, { requestedFor: "u1", quantity: 2, display: { u1: "مریم" } })).toBe("لپ‌تاپ حرفه‌ای برای مریم — 2 عدد");
    expect(titleOf({ ...laptop, item: { ...laptop.item, title_template: "" } }, {})).toBe("لپ‌تاپ");
    expect(answerText(laptop.variables[1], ["bag", "mouse"])).toBe("کیف، ماوس");
    expect(answerText(laptop.variables[3], true)).toBe("بله");
    expect(answerText(laptop.variables[6], "1234")).toBe("••••");
  });

  it("starts from defaults ($me, $today, literals, lists)", () => {
    const s: FormSchema = { ...laptop, variables: [v("who", "user", { default: "$me" }), v("when", "date", { default: "$today" }), v("ok", "bool", { default: "true" }), v("tags", "multiselect", { default: "a، b", choices: [{ value: "a", label: "a" }, { value: "b", label: "b" }] })] };
    expect(defaultAnswers(s, { me: "u1", today: "2026-11-08" })).toEqual({ who: "u1", when: "2026-11-08", ok: true, tags: ["a", "b"], users: [{}] });
  });

  it("cascades a guide's answers to items with the same question name and a compatible type", () => {
    const to: FormSchema = { ...laptop, variables: [v("model", "select", { choices: [{ value: "std", label: "s" }] }), v("address", "string"), v("ram_gb", "string"), v("pin", "secret")] };
    expect(cascade({ model: "std", address: "x", ram_gb: 8, pin: "1" }, laptop.variables, to)).toEqual({ model: "std", address: "x" });
    expect(cascade({ model: "pro" }, laptop.variables, to)).toEqual({}); // not an option there
  });

  it("includes a guide's items by their conditions (empty = always, inactive rules never)", () => {
    const rules = [
      { id: "r1", condition: null },
      { id: "r2", condition: { f: "replace", op: "eq" as const, v: true } },
      { id: "r3", condition: null, active: false },
    ];
    expect(guideIncludes(rules, laptop, { replace: false }).map((r) => r.id)).toEqual(["r1"]);
    expect(guideIncludes(rules, laptop, { replace: true }).map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("finds problems of policies: unknown questions, bad conditions, no actions", () => {
    expect(policyProblem(laptop, { when: null, actions: [{ variable: "nope", visible: true }] })).toContain("nope");
    expect(policyProblem(laptop, { when: { f: "missing", op: "eq", v: 1 }, actions: [{ variable: "note", visible: true }] })).toBeTruthy();
    expect(policyProblem(laptop, { when: null, actions: [] })).toBeTruthy();
    expect(policyProblem(laptop, { when: { f: "full_name", op: "nempty" }, actions: [{ variable: "email", mandatory: true }], grid: "users" })).toBeNull();
  });
});

describe("audiences", () => {
  const me: MemberFacts = { userId: "u1", groups: ["g1"], unitPath: ["unit-b", "unit-a"], locationPath: ["loc-2", "loc-1"], roles: ["agent"], persona: "agent", vip: false };
  const aud = (row: Record<string, unknown>) => audienceOf({ id: String(row.id ?? "a"), active: true, ...row });

  it("matches by any or all of the filled criteria; an audience without criteria matches nobody", () => {
    expect(audienceMatches(aud({ groups: ["g1"], roles: ["x"] }), me)).toBe(true);
    expect(audienceMatches(aud({ groups: ["g1"], roles: ["x"], match: "all" }), me)).toBe(false);
    expect(audienceMatches(aud({}), me)).toBe(false);
    expect(audienceMatches(aud({ users: ["u1"], active: false }), me)).toBe(false);
  });

  it("walks units and locations up their trees unless sub-trees are excluded", () => {
    expect(audienceMatches(aud({ units: ["unit-a"] }), me)).toBe(true);
    expect(audienceMatches(aud({ units: ["unit-a"], include_subunits: false }), me)).toBe(false);
    expect(audienceMatches(aud({ locations: ["loc-1"] }), me)).toBe(true);
    expect(pathUp("/unit-a/unit-b/", "unit-b")).toEqual(["unit-b", "unit-a"]);
  });

  it("lets denial win and an empty allow list mean everyone, at every level down to the item", () => {
    const audiences = new Map([
      ["agents", aud({ id: "agents", roles: ["agent"] })],
      ["vips", aud({ id: "vips", vip_only: true })],
    ]);
    expect(allows({}, audiences, me)).toBe(true);
    expect(allows({ available_for: ["vips"] }, audiences, me)).toBe(false);
    expect(allows({ available_for: ["agents"], not_available_for: ["agents"] }, audiences, me)).toBe(false);
    expect(entitled([{}, { available_for: ["agents"] }, { not_available_for: ["vips"] }], audiences, me)).toBe(true);
    expect(entitled([{ available_for: ["vips"] }, {}], audiences, me)).toBe(false);
  });

  it("evaluates a profile condition through the caller's evaluator", () => {
    const a = aud({ id: "c", condition: { f: "title", op: "contains", v: "مدیر" } });
    expect(audienceMatches(a, me)).toBe(false);
    expect(audienceMatches(a, me, () => true)).toBe(true);
  });
});

describe("delivery promises and expectations", () => {
  const cal = calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, [{ date: "2026-11-14", title: "تعطیل" }]);
  const at = (s: string) => Date.parse(s);

  it("counts working days on the calendar: today counts while it has working time, Fridays and holidays never", () => {
    const wed10 = at("2026-11-11T06:30:00Z"); // Wednesday 10:00 Tehran
    expect(new Date(workingDaysDue(cal, wed10, 0)!).toISOString()).toBe("2026-11-11T12:30:00.000Z"); // Wednesday 16:00
    expect(new Date(workingDaysDue(cal, wed10, 1)!).toISOString()).toBe("2026-11-12T08:30:00.000Z"); // Thursday 12:00 (half day)
    // Friday off, Saturday 14th a holiday → Sunday 16:00
    expect(new Date(workingDaysDue(cal, wed10, 2)!).toISOString()).toBe("2026-11-15T12:30:00.000Z");
    const wed17 = at("2026-11-11T13:30:00Z"); // Wednesday 17:00: today is over
    expect(new Date(workingDaysDue(cal, wed17, 0)!).toISOString()).toBe("2026-11-12T08:30:00.000Z");
    expect(workingDaysDue(null, wed10, 2)).toBe(wed10 + 2 * 86_400_000);
  });

  it("says the promise in Persian", () => {
    expect(promiseText(5)).toBe("حدود ۵ روز کاری");
    expect(promiseText(0)).toBe("همان روز کاری");
    expect(promiseText(null)).toBe("");
  });

  it("computes percentiles by nearest rank and an SLE only with enough samples", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 85)).toBe(90);
    expect(percentile([], 50)).toBeNull();
    expect(sle(xs)).toEqual({ p50: 50, p85: 90, p95: 100, samples: 10 });
    expect(sleText(3 * 86400, 10)).toBe("۸۵٪ درخواست‌ها در کمتر از ۳ روز انجام شده‌اند");
    expect(sleText(5400, 10)).toBe("۸۵٪ درخواست‌ها در کمتر از ۲ ساعت انجام شده‌اند");
    expect(sleText(3 * 86400, 2)).toBe("");
  });
});

describe("lifecycle", () => {
  it("derives the stage from the state on the item's bar (and keeps a flow's stage while working)", () => {
    expect(stageFor("pending")).toBe("submitted");
    expect(stageFor("awaiting_approval")).toBe("approval");
    expect(stageFor("backordered", ["submitted", "fulfilment", "completed"])).toBe("fulfilment"); // no «تأمین» on the bar
    expect(stageFor("in_fulfilment", ["submitted", "approval", "sourcing", "fulfilment", "delivery", "completed"], "sourcing")).toBe("sourcing");
    expect(stageFor("awaiting_approval", ["submitted", "fulfilment", "completed"])).toBe("submitted");
    expect(stageFor("rejected", ["submitted"])).toBe("rejected");
    expect(stageIndex("completed", ["a", "b", "c"])).toBe(2);
  });

  it("rolls an order up from its items", () => {
    const r = (...states: string[]) => rollupRequest(states.map((state) => ({ state })))?.state;
    expect(rollupRequest([])).toBeNull();
    expect(r("pending")).toBe("submitted");
    expect(r("awaiting_approval", "pending")).toBe("awaiting_approval");
    expect(r("awaiting_approval", "in_fulfilment")).toBe("in_fulfilment");
    expect(r("in_fulfilment", "awaiting_info")).toBe("awaiting_info");
    expect(r("delivered", "closed_complete")).toBe("delivered");
    expect(r("closed_complete", "closed_complete")).toBe("closed_complete");
    expect(r("closed_complete", "rejected")).toBe("closed_incomplete");
    expect(r("rejected", "cancelled")).toBe("rejected");
    expect(r("cancelled")).toBe("cancelled");
    expect(rollupRequest([{ state: "awaiting_approval", stage: "approval" }, { state: "in_fulfilment", stage: "fulfilment" }])?.stage).toBe("approval");
    expect(rollupRequest([{ state: "closed_complete" }])?.stage).toBe("completed");
  });

  it("opens waiting tasks whose predecessor is done, and judges an item's tasks", () => {
    const tasks = [
      { id: "a", state: "closed_complete" },
      { id: "b", state: "pending", depends_on: "a" },
      { id: "c", state: "pending", depends_on: "b" },
      { id: "d", state: "pending", depends_on: "gone" },
    ];
    expect(readyTasks(tasks)).toEqual(["b", "d"]);
    expect(tasksOutcome([])).toBe("none");
    expect(tasksOutcome([{ state: "closed_complete" }, { state: "open" }])).toBe("open");
    expect(tasksOutcome([{ state: "closed_complete" }, { state: "skipped" }, { state: "cancelled" }])).toBe("done");
    expect(tasksOutcome([{ state: "closed_incomplete" }, { state: "closed_complete" }])).toBe("failed");
    expect(tasksOutcome([{ state: "cancelled" }])).toBe("failed");
  });

  it("applies the requester's cancel policy and answer editing window", () => {
    expect(cancelRefusal("never", "pending")).toBeTruthy();
    expect(cancelRefusal("before_approval", "awaiting_approval")).toBeNull();
    expect(cancelRefusal("before_fulfilment", "in_fulfilment")).toBeTruthy();
    expect(cancelRefusal("anytime", "backordered")).toBeNull();
    expect(cancelRefusal("anytime", "delivered")).toBeTruthy();
    expect(answersEditable(true, "awaiting_approval")).toBe(true);
    expect(answersEditable(false, "pending")).toBe(false);
    expect(answersEditable(true, "in_fulfilment")).toBe(false);
  });

  it("titles orders, lists the people of a line and implies close codes", () => {
    expect(orderTitle(["لپ‌تاپ"])).toBe("لپ‌تاپ");
    expect(orderTitle(["لپ‌تاپ", "VPN", "ایمیل"])).toBe("لپ‌تاپ و ۲ قلم دیگر");
    expect(orderTitle([])).toBe("درخواست خدمت");
    expect(linePeople({ requested_for_list: ["a", "b", "a"] }, "me", true)).toEqual(["a", "b"]);
    expect(linePeople({ requested_for_list: ["a"] }, "me", false)).toEqual(["me"]);
    expect(linePeople({ requested_for: "x" }, "me", true)).toEqual(["x"]);
    expect(closeCodeFor("closed_complete")).toBe("fulfilled");
    expect(closeCodeFor("closed_complete", "converted")).toBe("converted");
    expect(closeCodeFor("in_fulfilment")).toBeNull();
  });
});
