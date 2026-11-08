// Services as retrieval documents (docs/spec/AI.md §3): the service's own words — name, type, tier and criticality,
// continuity, support channels and hours, the consumer description, value proposition and outcomes, the English
// name and description — never other records' names (an offering or a dependency may be hidden from a reader of the
// service). Offerings are indexed by their table's `ai` declaration (description, utility, warranty).
import { registerRagSource } from "../ai/rag";
import { SERVICE_STATES, SERVICE_TYPES } from "@shared/tables/service_portfolio";
import { CI_TIERS } from "@shared/tables/cmdb";
import { CI_CRITICALITY } from "@shared/cmdb/classes";

const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v ? String(v) : "");

export function installPortfolioRag(): () => void {
  return registerRagSource({
    table: "service",
    version: "svc1",
    path: (id) => `services/${id}`,
    async build({ row }) {
      const facts = [
        `نوع: ${label(SERVICE_TYPES, row.service_type)}`,
        `مرحله: ${SERVICE_STATES.states.find((s) => s.value === row.state)?.label ?? ""}`,
        row.tier ? `رده: ${label(CI_TIERS, row.tier)}` : "",
        row.criticality ? `اهمیت: ${label(CI_CRITICALITY, row.criticality)}` : "",
        row.availability_target ? `هدف دسترس‌پذیری: ${row.availability_target}٪` : "",
        row.service_key ? `شناسهٔ مهندسی: ${row.service_key}` : "",
        Array.isArray(row.tags) && row.tags.length ? `برچسب‌ها: ${row.tags.join("، ")}` : "",
      ].filter(Boolean);
      const parts: { field: string; label: string; text: string; group: null; format: "text" | "markdown" }[] = [{ field: "service_type", label: "مشخصات", text: facts.join("\n"), group: null, format: "text" }];
      for (const [field, lab] of [["description", "شرح"], ["value_proposition", "ارزش پیشنهادی"], ["outcomes", "نتایج مورد انتظار"], ["description_en", "Description"]] as const) {
        if (row[field]) parts.push({ field, label: lab, text: String(row[field]), group: null, format: "markdown" });
      }
      const title = [row.name, row.name_en].filter(Boolean).join(" — ");
      return { title: String(title || row.name || ""), titleField: "name", number: (row.number as string) ?? null, parts: parts as never };
    },
  });
}
