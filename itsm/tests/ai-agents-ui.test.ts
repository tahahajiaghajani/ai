// Pure logic of the agents and the virtual agent: the rules the server enforces and the studio shows (allowed tools,
// guardrails on what would be written, the autonomy whitelist, configuration problems), the studio's model (groups,
// the tool picker, run steps), the assistant's page awareness (record and list pages of every record module) and the
// virtual agent's cards as plain text for channels without buttons.
import { describe, expect, it } from "vitest";
import {
  agentConfigProblems, autoActionProblem, autoApplicable, guardrailProblem, skillToolName, toolAllowed, toolPatternProblem, type AgentAdminItem, type AgentToolOption,
} from "@shared/ai/agents";
import { cardText, type VaCard } from "@shared/ai/va";
import { AI_AGENT_TABLES } from "@shared/tables/ai-agents";
import { groupAgents, principalText, stepLine, togglePattern, toolGroups } from "../src/ui/ai/agents/model";
import { pageContext, registerRecordRoute } from "../src/ui/ai/assistant/context";

const g = { forbidden_tables: ["approval"], forbidden_fields: ["impact", "incident.urgency"], forbidden_states: ["incident:canceled", "closed"] };

describe("agent rules", () => {
  it("matches allowed tools by name, prefix pattern and skill", () => {
    expect(toolAllowed(["get_*"], "get_incident")).toBe(true);
    expect(toolAllowed(["get_*"], "search_incident")).toBe(false);
    expect(toolAllowed(["search_incident"], "search_incident")).toBe(true);
    expect(toolAllowed(["skill:incident.triage"], skillToolName("incident.triage"), "incident.triage")).toBe(true);
    expect(toolAllowed(["*"], "skill_x", "x")).toBe(false);
    expect(toolPatternProblem("draft_update_incident")).toBeNull();
    expect(toolPatternProblem("DROP TABLE")).toBeTruthy();
  });

  it("checks guardrails on the payload that would be written", () => {
    expect(guardrailProblem(g, { kind: "record.update", payload: { table: "incident", data: { impact: "1" } } })).toContain("impact");
    expect(guardrailProblem(g, { kind: "record.update", payload: { table: "incident", data: { urgency: "1" } } })).toContain("urgency");
    expect(guardrailProblem(g, { kind: "record.update", payload: { table: "problem", data: { urgency: "1" } } })).toBeNull();
    expect(guardrailProblem(g, { kind: "record.transition", payload: { table: "incident", to: "canceled", data: {} } })).toContain("canceled");
    expect(guardrailProblem(g, { kind: "record.batch", payload: { table: "change_request", to: "closed", data: {} } })).toContain("closed");
    expect(guardrailProblem(g, { kind: "record.link", payload: { table: "incident", to_table: "approval" } })).toContain("approval");
    expect(guardrailProblem(g, { kind: "record.journal", payload: { table: "incident", kind: "work_note" } })).toBeNull();
  });

  it("applies on its own only what the whitelist names", () => {
    const w = ["draft_update_incident:urgency", "draft_journal_entry:work_note"];
    expect(autoApplicable(w, { kind: "record.update", payload: { table: "incident", data: { urgency: "1" } } })).toBe(true);
    expect(autoApplicable(w, { kind: "record.update", payload: { table: "incident", data: { urgency: "1", impact: "1" } } })).toBe(false);
    expect(autoApplicable(w, { kind: "record.journal", payload: { table: "incident", kind: "work_note" } })).toBe(true);
    expect(autoApplicable(w, { kind: "record.journal", payload: { table: "incident", kind: "comment" } })).toBe(false);
    for (const kind of ["record.create", "record.transition", "record.batch", "record.link"]) expect(autoApplicable(w, { kind, payload: { table: "incident" } })).toBe(false);
    expect(autoActionProblem("draft_journal_entry:comment")).toContain("هرگز");
    expect(autoActionProblem("draft_link_records")).toBeNull();
  });

  it("finds configuration problems in Persian", () => {
    expect(agentConfigProblems({ triggers: ["event"], events: [], tables: [] }).length).toBe(2);
    expect(agentConfigProblems({ triggers: ["schedule"], schedule_minutes: null })[0]).toContain("دقیقه");
    expect(agentConfigProblems({ autonomy: "suggest", auto_actions: ["draft_link_records"] })[0]).toContain("اقدام خودکار");
    expect(agentConfigProblems({ key: "Bad Key" })[0]).toContain("کلید");
    expect(agentConfigProblems({ key: "ok_key", goal: "هدف روشن این عامل است", triggers: ["manual"], tools: ["get_*"], autonomy: "suggest", auto_actions: [] })).toEqual([]);
  });

  it("keeps the agent and virtual agent tables out of sync and the generic API", () => {
    const run = AI_AGENT_TABLES.find((t) => t.key === "ai_agent_run")!;
    expect(run.features?.sync).toBe(false);
    expect(run.rowAccess?.read).toEqual({ f: "agent_key", op: "empty" });
    for (const k of ["va_conversation", "va_message"]) expect(AI_AGENT_TABLES.find((t) => t.key === k)!.rowAccess?.read).toEqual({ f: "requester_id", op: "is_me" });
  });
});

const item = (over: Partial<AgentAdminItem>): AgentAdminItem =>
  ({
    id: "1", key: "k", name: "عامل", description: "", module: "incident", builtin: true, base_key: "k", enabled: false, goal: "", tables: [], triggers: ["manual"], events: [], condition: null,
    schedule_minutes: null, schedule_filter: null, tools: [], autonomy: "suggest", auto_actions: [], approvers: [], approver_group_id: null, tier: "standard", max_steps: 8, max_tokens: 60000,
    max_actions: 5, daily_runs: 50, forbidden_tables: [], forbidden_fields: [], forbidden_states: [], roles: [], field_groups: [], principal_id: null,
    principal: { user_id: null, name: null, roles: [], active: false }, runs_today: 0, last_run: null, open_proposals: 0, ...over,
  }) as AgentAdminItem;

describe("the studio's model", () => {
  it("groups agents by module, the organisation's own last, with search", () => {
    const groups = groupAgents([item({ key: "a", module: "ai", name: "گزارش" }), item({ key: "b", module: "incident", name: "تریاژ" }), item({ key: "c", module: "change", name: "بازبین" })], "");
    expect(groups[groups.length - 1].module).toBe("ai");
    expect(groupAgents([item({ key: "b", name: "تریاژ رخداد" })], "تریاژ")[0].items.length).toBe(1);
    expect(groupAgents([item({ key: "b", name: "تریاژ رخداد" })], "تغییر").length).toBe(0);
  });

  it("builds the tool picker from patterns and toggles exact names", () => {
    const options: AgentToolOption[] = [
      { name: "get_incident", title_fa: "خواندن رخداد", kind: "read", table: "incident", available: true },
      { name: "draft_update_incident", title_fa: "پیش‌نویس تغییر رخداد", kind: "propose", table: "incident", available: false },
      { name: "search_knowledge", title_fa: "جست‌وجوی دانش", kind: "read", table: null, available: true },
      { name: "skill:incident.triage", title_fa: "مهارت", kind: "meta", table: null, available: true },
    ];
    const groups = toolGroups(options, ["get_*", "skill:incident.triage"]);
    const inc = groups.find((x) => x.key === "incident")!;
    expect(inc.tools.find((t) => t.name === "get_incident")).toMatchObject({ checked: true, viaPattern: true });
    expect(inc.tools.find((t) => t.name === "draft_update_incident")).toMatchObject({ checked: false, available: false });
    expect(groups.find((x) => x.key === "skills")!.tools[0].checked).toBe(true);
    expect(groups.map((x) => x.key).slice(-2)).toEqual(["platform", "skills"]);
    expect(togglePattern(["get_*"], "search_knowledge", true)).toEqual(["get_*", "search_knowledge"]);
    expect(togglePattern(["get_*", "search_knowledge"], "search_knowledge", false)).toEqual(["get_*"]);
  });

  it("reads the principal and the steps of a run", () => {
    const names = new Map([["agent", "کارشناس"]]);
    expect(principalText({ user_id: null, name: null, roles: [], active: false }, names)).toBe("بی‌هویت");
    expect(principalText({ user_id: "u", name: "عامل", roles: ["agent"], active: true }, names)).toBe("کارشناس");
    expect(stepLine({ n: 1, at: "", kind: "tool", tool: "draft_update_incident", ok: true, proposal: { title_fa: "تغییر", kind: "record.update", applied: false, dry: true } }).detail).toContain("آزمایشی");
    expect(stepLine({ n: 2, at: "", kind: "tool", tool: "x", ok: false, error: "ممنوع" }).tone).toBe("bad");
  });
});

describe("page awareness of the assistant", () => {
  it("knows the record and the list of every record module and of r/<table>", () => {
    registerRecordRoute("service-desk/incidents", "incident");
    const id = "01a1c051-effc-7015-99d2-736423d7c9c9";
    expect(pageContext(`service-desk/incidents/${id}`, "", "رخداد").record).toEqual({ type: "incident", id, label: "رخداد" });
    expect(pageContext("service-desk/incidents", "?state=new", null).list).toEqual({ table: "incident", params: { state: "new" } });
    expect(pageContext(`r/problem/${id}`, "", null).record?.type).toBe("problem");
    expect(pageContext("r/problem", "", null).list).toEqual({ table: "problem" });
    expect(pageContext("r/not_a_table", "", null).list).toBeUndefined();
    expect(pageContext("service-desk/incidents/new", "", null).record).toBeUndefined();
  });
});

describe("virtual agent cards as text", () => {
  it("renders every card for channels without buttons", () => {
    const cards: VaCard[] = [
      { kind: "choices", options: [{ value: "a", label: "گزینهٔ یک" }] },
      { kind: "confirm", what: "incident", title: "گزارش مشکل", rows: [{ label: "عنوان", value: "چاپگر" }] },
      { kind: "tickets", total: 1, items: [{ table: "incident", id: "1", number: "INC1", title: "چاپگر", path: "x", table_label: "رخداد", state: "new", state_label: "تازه", updated_at: null, last_reply: null }] },
    ];
    expect(cardText(cards[0])).toBe("1. گزینهٔ یک");
    expect(cardText(cards[1])).toContain("عنوان: چاپگر");
    expect(cardText(cards[2])).toBe("INC1 چاپگر — تازه");
  });
});
