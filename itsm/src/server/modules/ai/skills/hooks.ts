// Guards of the skills tables, on every write path (the generic record API included). Whatever a role grants in area
// `ai`, only AI administrators (`ai:full`) or the platform itself change skills, their versions and evaluation sets;
// runs are written only by the runtime. Keys never change, a built-in's row is never deleted (switch it off), a
// published version is never edited (write a new one), templates and output schemas are checked before they are saved.
import { registerHooks } from "../../../engine";
import type { WriteArgs } from "../../../engine";
import { bad, forbidden } from "../../../http/errors";
import { enqueue } from "../../../jobs";
import { AI_SKILL, AI_SKILL_EVAL, AI_SKILL_RUN, AI_SKILL_VERSION } from "@shared/tables/ai";
import { schemaShapeProblem, templateProblem } from "@shared/ai/skills";
import { tableDef } from "@shared/tables";
import { isSkillKey, skillDef } from "./registry";
import { invalidateTriggers } from "./triggers";

const ADMIN_ONLY = "مهارت‌های هوش مصنوعی را فقط مدیر هوش مصنوعی سازمان تغییر می‌دهد";

function needAdmin(w: WriteArgs): void {
  if (w.ctx.actor === "system") return;
  if (!w.ctx.can("ai", "full")) throw forbidden(ADMIN_ONLY);
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

let installed = false;
export function installSkillHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks(AI_SKILL, {
    beforeWrite(w) {
      needAdmin(w);
      const n = w.next as Record<string, unknown>;
      if (w.op === "create") {
        if (!isSkillKey(String(n.key ?? ""))) throw bad("کلید مهارت باید با حرف لاتین کوچک شروع شود و فقط حرف، رقم، نقطه و _ داشته باشد");
        const base = skillDef(String(n.base_key || n.key));
        if (!base) throw bad("هر مهارت بر پایهٔ یکی از مهارت‌های داخلی ساخته می‌شود");
        if (!n.base_key) n.base_key = base.key;
        n.module = base.module;
        n.target = base.target;
        n.output = base.output;
        if (n.builtin && n.key !== base.key) n.builtin = false;
      } else if (w.op === "update" && w.prev) {
        if (w.changed.has("key") || w.changed.has("base_key")) throw bad("کلید مهارت پس از ساخت تغییر نمی‌کند");
      }
      if (w.op === "delete" && w.prev?.builtin && w.ctx.actor !== "system") throw bad("مهارت داخلی حذف نمی‌شود؛ آن را خاموش کنید");
      if (w.op !== "delete") {
        for (const t of strings(n.tables)) if (t !== "*" && !tableDef(t)) throw bad(`جدول «${t}» شناخته نیست`);
        const triggers = strings(n.triggers);
        if (triggers.includes("schedule") && !n.schedule_minutes) throw bad("برای اجرای زمان‌بندی‌شده بازهٔ اجرا (دقیقه) را بنویسید");
        if (triggers.includes("event") && !strings(n.events).length) throw bad("برای اجرای خودکار با رویداد، دست‌کم یک رویداد را برگزینید");
        if (n.condition !== null && n.condition !== undefined && (typeof n.condition !== "object" || Array.isArray(n.condition))) throw bad("شرط اجرای خودکار باید یک شرط معتبر باشد");
        for (const f of strings(n.auto_apply)) if (!/^[a-z][a-z0-9_]{0,62}$/.test(f)) throw bad(`«${f}» نام فیلد نیست`);
      }
    },
    async afterWrite(w) {
      invalidateTriggers(w.ctx.org.id);
      const n = w.next as Record<string, unknown>;
      // a skill with a schedule was created or its schedule changed (not the round's own «last_scheduled_at» stamp)
      const scheduleChanged = w.op === "create" || ["triggers", "schedule_minutes", "schedule_filter", "enabled", "tables"].some((f) => w.changed.has(f));
      if (w.op !== "delete" && scheduleChanged && n.enabled !== false && strings(n.triggers).includes("schedule")) {
        await enqueue(w.tx, { kind: "ai.skills.schedule", orgId: w.ctx.org.id, payload: {}, dedupeKey: "ai.skills.schedule", delayMs: 5_000 });
      }
    },
  });
  registerHooks(AI_SKILL_VERSION, {
    beforeWrite(w) {
      needAdmin(w);
      if (w.ctx.actor === "system") return;
      const n = w.next as Record<string, unknown>;
      if (w.op === "update" && w.prev && w.prev.state !== "draft" && (w.changed.has("system") || w.changed.has("template") || w.changed.has("output_schema"))) {
        throw bad("نسخهٔ منتشرشده تغییر نمی‌کند؛ نسخهٔ تازه‌ای بنویسید");
      }
      if (w.op !== "delete") {
        const problem = templateProblem(String(n.template ?? ""));
        if (problem) throw bad(problem);
        const sp = schemaShapeProblem(n.output_schema);
        if (sp) throw bad(sp);
      }
      if (w.op === "delete" && w.prev?.state === "published") throw bad("نسخهٔ منتشرشده حذف نمی‌شود");
    },
  });
  registerHooks(AI_SKILL_EVAL, {
    beforeWrite(w) {
      needAdmin(w);
      const n = w.next as Record<string, unknown>;
      if (w.op !== "delete" && !Array.isArray(n.cases)) throw bad("نمونه‌های ارزیابی باید فهرستی از نمونه‌ها باشد");
    },
  });
  registerHooks(AI_SKILL_RUN, {
    beforeWrite(w) {
      // runs are the runtime's log: nobody writes, edits or deletes one through the API
      if (w.ctx.actor !== "system") throw forbidden("اجراهای مهارت را فقط سامانه ثبت می‌کند");
    },
  });
}
