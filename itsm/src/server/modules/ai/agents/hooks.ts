// Guards of the agents' and the virtual agent's tables, on every write path (the generic record API and sync pushes
// included). Whatever a role grants in area `ai`, only AI administrators (`ai:full`) or the platform change agents and
// topics; runs, conversations and messages are written only by the runtime. An agent's key never changes, a built-in
// agent is switched off rather than deleted, the principal is set only through the studio (an owner chooses its roles),
// and a configuration with problems (tools, whitelist, triggers) is refused with the problems in Persian.
import { registerHooks } from "../../../engine";
import { enqueue } from "../../../jobs";
import type { WriteArgs } from "../../../engine";
import { bad, forbidden } from "../../../http/errors";
import { agentConfigProblems, type AgentConfig } from "@shared/ai/agents";
import { AI_AGENT, AI_AGENT_RUN, VA_CONVERSATION, VA_MESSAGE, VA_TOPIC } from "@shared/tables/ai-agents";
import { tableDef } from "@shared/tables";
import { configOf } from "./config";
import { invalidateAgentTriggers } from "./triggers";

const ADMIN_ONLY = "عامل‌های هوش مصنوعی را فقط مدیر هوش مصنوعی سازمان تغییر می‌دهد";

function needAdmin(w: WriteArgs, message = ADMIN_ONLY): void {
  if (w.ctx.actor === "system") return;
  if (!w.ctx.can("ai", "full")) throw forbidden(message);
}

function runtimeOnly(w: WriteArgs, what: string): void {
  if (w.ctx.actor !== "system") throw forbidden(`${what} را فقط سامانه ثبت می‌کند`);
}

let installed = false;
export function installAgentHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks(AI_AGENT, {
    beforeWrite(w) {
      needAdmin(w);
      const n = w.next as Record<string, unknown>;
      if (w.op === "update" && w.prev && (w.changed.has("key") || w.changed.has("base_key") || w.changed.has("builtin"))) throw bad("کلید عامل پس از ساخت تغییر نمی‌کند");
      if (w.op === "delete" && w.prev?.builtin && !w.trusted) throw bad("عامل داخلی حذف نمی‌شود؛ آن را خاموش کنید");
      // the principal is the studio's (an owner gives it roles through the access service), never a field edit
      if (w.ctx.actor !== "system" && !w.trusted && (w.op === "create" ? n.principal_id : w.changed.has("principal_id"))) throw forbidden("هویت عامل را فقط از «عامل‌ها» در تنظیمات هوش مصنوعی می‌سازند");
      if (w.op === "delete") return;
      const cfg: Partial<AgentConfig> = configOf(n);
      const problems = agentConfigProblems(cfg);
      for (const t of [...cfg.tables!, ...cfg.forbidden_tables!]) if (!tableDef(t)) problems.push(`جدول «${t}» شناخته نیست`);
      if (problems.length) throw bad(problems.join("؛ "));
    },
    async afterWrite(w) {
      invalidateAgentTriggers(w.ctx.org.id);
      const n = w.next as Record<string, unknown>;
      // an agent with a schedule was created, switched on or rescheduled (not the round's own «last_scheduled_at» stamp)
      const changed = w.op === "create" || ["triggers", "schedule_minutes", "schedule_filter", "enabled", "tables"].some((f) => w.changed.has(f));
      if (w.op !== "delete" && changed && n.enabled === true && Array.isArray(n.triggers) && n.triggers.includes("schedule")) {
        await enqueue(w.tx, { kind: "ai.agents.schedule", orgId: w.ctx.org.id, payload: {}, dedupeKey: "ai.agents.schedule", delayMs: 5_000 });
      }
    },
  });
  registerHooks(VA_TOPIC, {
    beforeWrite(w) {
      needAdmin(w, "موضوع‌های دستیار مجازی را فقط مدیر هوش مصنوعی سازمان تغییر می‌دهد");
      const n = w.next as Record<string, unknown>;
      if (w.op === "update" && w.changed.has("key")) throw bad("کلید موضوع پس از ساخت تغییر نمی‌کند");
      if (w.op === "delete" && w.prev?.builtin && !w.trusted) throw bad("موضوع داخلی حذف نمی‌شود؛ آن را خاموش کنید");
      if (w.op !== "delete") {
        if (!/^[a-z][a-z0-9_.]{1,59}$/.test(String(n.key ?? ""))) throw bad("کلید موضوع باید با حرف لاتین کوچک شروع شود و فقط حرف، رقم، نقطه و _ داشته باشد");
        if (n.kind === "catalog_item" && !n.item_id) throw bad("برای «قلم مشخص کاتالوگ» قلم را برگزینید");
        if (n.kind === "answer" && !String(n.answer ?? "").trim()) throw bad("برای «پاسخ ثابت» متن پاسخ را بنویسید");
      }
    },
  });
  registerHooks(AI_AGENT_RUN, { beforeWrite: (w) => runtimeOnly(w, "اجراهای عامل") });
  registerHooks(VA_CONVERSATION, { beforeWrite: (w) => runtimeOnly(w, "گفتگوهای دستیار مجازی") });
  registerHooks(VA_MESSAGE, { beforeWrite: (w) => runtimeOnly(w, "پیام‌های دستیار مجازی") });
}
