// Shared between the server and the UI (release 1.1.5): why a workflow step that opened has nobody to act, the
// managers' «دوباره پیدا کردن انجام‌دهنده» action, and the demo pack's people in assignee pickers.

/** A step whose open round has no open task: nobody was found, or more people than the step takes. */
export interface StepWaiting {
  reason: "nobody" | "too_many";
  /** the line the case journal shows («برای «…» کسی پیدا نشد؛ …») */
  message: string;
  /** the resolver's reasons (Persian), e.g. «مدیر گروه» در «ادارهٔ کل فناوری اطلاعات» دارنده‌ای ندارد */
  notes: string[];
  /** too_many: whom the managers may choose from (at most 500); only for the case's managers */
  candidates?: { id: string; name: string; demo: boolean }[];
}

/** POST /process/cases/:id/reresolve — the case's managers run a waiting step's rules again. */
export interface ReresolveInput {
  /** the waiting step's node id */
  step: string;
  /**
   * "case" (default): the rules of the case's own version, with today's holders; "current": the rules the process's
   * current published version has for the same node id (the step's form and rights stay the case version's)
   */
  rules?: "case" | "current";
}

export interface ReresolveResult {
  status: "ok" | "managers" | "nobody" | "too_many";
  people: { id: string; name: string; demo: boolean }[];
  message: string | null;
  notes: string[];
}

/** GET /positions/demo-people — the organisation's demo pack people (lower-case ids; empty without a pack). */
export interface DemoPeople {
  users: string[];
}
