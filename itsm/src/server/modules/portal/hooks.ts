// Hooks of the portal's tables (same transaction as the write; no model or network calls):
//   · rows the module alone writes — preferences, invitations, responses, messenger identities and link codes — are
//     refused on every other path (the record API, imports, flows), whoever asks
//   · the portal's home layout is kept clean (`normalizeLayout`); a topic never sits under itself
//   · public knowledge is published and its bases chosen only by the knowledge area's approvers and administrators
//   · feedback: complaints and privacy requests are confidential (the group, the submitter and the access list), the
//     right asked for belongs to privacy requests only; «اعلام دریافت» and «پاسخ» are stamped when they happen
//   · surveys: a question's metric fits its kind, choices have options; a trigger names a table whose records have a
//     requester and reach «حل شد» or «بسته شد»
//   · connectors and widgets: their secrets and keys come from the module's routes; a widget's allowed sites are
//     origins (scheme, host and port)
import { normalizeLayout } from "@shared/portal/logic";
import { originOf } from "@shared/portal/logic";
import { tableDef } from "@shared/tables";
import { registerHooks, type WriteArgs } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { publishesKnowledge, type Row } from "./common";
import { requesterFields } from "./items";

function runtimeOnly(w: WriteArgs, what: string): void {
  if (w.ctx.actor !== "system") throw forbidden(`${what} را فقط سامانه ثبت می‌کند`);
}

const METRIC_KINDS: Record<string, string[]> = {
  csat: ["rating", "faces", "scale10"],
  ces: ["ces"],
  nps: ["nps", "scale10"],
  happiness: ["scale10", "nps"],
  lost_time: ["minutes"],
};

let installed = false;
export function installPortalHooks(): void {
  if (installed) return;
  installed = true;

  registerHooks("portal", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      if (w.changed.has("layout") && w.next.layout !== null && w.next.layout !== undefined) w.next.layout = normalizeLayout(w.next.layout);
    },
  });

  registerHooks("portal_topic", {
    async beforeWrite(w) {
      if (w.op === "delete" || !w.changed.has("parent_id") || !w.next.parent_id) return;
      // walk up from the new parent: the topic itself must not appear
      let cur: unknown = w.next.parent_id;
      for (let i = 0; i < 20 && typeof cur === "string"; i++) {
        if (cur === w.next.id) throw bad("موضوع نمی‌تواند زیر خودش یا زیرموضوع‌هایش باشد");
        const r = await w.tx.one<{ parent_id: string | null }>(`select parent_id from sm_portal_topics where org_id = $1 and id = $2 and deleted_at is null`, [w.ctx.org.id, cur]);
        cur = r?.parent_id ?? null;
      }
    },
  });

  registerHooks("portal_pref", { beforeWrite: (w) => runtimeOnly(w, "ترجیح‌های درگاه") });
  registerHooks("survey_invitation", { beforeWrite: (w) => runtimeOnly(w, "دعوت‌های نظرسنجی") });
  registerHooks("survey_response", { beforeWrite: (w) => runtimeOnly(w, "پاسخ‌های نظرسنجی") });
  registerHooks("portal_channel_identity", { beforeWrite: (w) => runtimeOnly(w, "حساب‌های پیام‌رسان") });
  registerHooks("portal_link_code", { beforeWrite: (w) => runtimeOnly(w, "کدهای اتصال") });

  registerHooks("portal_kb_publication", {
    beforeWrite(w) {
      if (w.ctx.actor === "system" || w.trusted) return;
      if (!publishesKnowledge(w.ctx)) throw forbidden("انتشار عمومی دانش با تأییدکنندگان و مدیران دانش است");
    },
  });

  registerHooks("portal_feedback", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next as Row;
      if (n.kind === "complaint" || n.kind === "privacy") n.confidential = true;
      if (n.kind !== "privacy") n.privacy_right = null;
      else if (!n.privacy_right && w.op === "create") n.privacy_right = "access";
      const now = new Date().toISOString();
      if (w.prev && w.prev.state === "new" && n.state !== "new" && !n.acknowledged_at) n.acknowledged_at = now;
      if (n.state === "responded" && (!w.prev || w.prev.state !== "responded")) n.responded_at = now;
    },
  });

  registerHooks("survey_question", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next as Row;
      const kind = String(n.kind ?? "rating");
      const metric = String(n.metric ?? "none");
      if (metric !== "none" && !(METRIC_KINDS[metric] ?? []).includes(kind)) throw bad("نوع پاسخ با شاخص این پرسش جور نیست");
      const options = Array.isArray(n.options) ? (n.options as string[]).filter((o) => String(o).trim()) : [];
      if ((kind === "choice" || kind === "multi") && options.length < 2) throw bad("پرسش چندگزینه‌ای دست‌کم دو گزینه لازم دارد");
    },
  });

  registerHooks("survey_trigger", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const key = String((w.next as Row).table_key ?? "");
      const def = tableDef(key);
      if (!def || def.virtual || !def.states) throw bad("جدولی با این کلید و با وضعیت پیدا نشد");
      if (!requesterFields(def).length) throw bad("رکوردهای این جدول درخواست‌کننده ندارند");
      const cats = new Set(def.states.states.map((s) => s.category));
      if (!cats.has(String((w.next as Row).fire_on ?? "resolved") as never)) throw bad("رکوردهای این جدول به این وضعیت نمی‌رسند");
      if (key.startsWith("survey") || def.module === "portal" && key !== "portal_feedback") throw bad("این جدول نظرسنجی نمی‌گیرد");
    },
  });

  registerHooks("portal_widget", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next as Row;
      if (w.changed.has("allowed_origins") || w.op === "create") {
        const list = Array.isArray(n.allowed_origins) ? (n.allowed_origins as string[]) : [];
        const clean: string[] = [];
        for (const o of list) {
          const origin = originOf(o);
          if (!origin) throw bad(`«${o}» نشانی وب‌سایت نیست؛ مثل https://www.example.com بنویسید`);
          if (!clean.includes(origin)) clean.push(origin);
        }
        if (!clean.length) throw bad("دست‌کم یک وب‌سایت مجاز بنویسید");
        n.allowed_origins = clean;
      }
    },
  });
}
