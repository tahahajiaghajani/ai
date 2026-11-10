// CIs as retrieval documents (docs/spec/AI.md §3): the CI's own words — name, class, description, environment and
// criticality, technical identity and its class attributes (never secrets, never other CIs' names: a relationship's
// other end may be hidden from a reader of this CI, so related names stay out of the document). Services and offerings
// are indexed by their table's `ai` declaration (description, value proposition, outcomes).
import { registerRagSource } from "../ai/rag";
import { CI_CRITICALITY, CI_ENVIRONMENTS } from "@shared/cmdb/classes";
import { classTree } from "./common";

const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v ? String(v) : "");

export function installCmdbRag(): () => void {
  return registerRagSource({
    table: "ci",
    version: "cmdb1",
    path: (id) => `cis/${id}`,
    async build({ ctx, q, row }) {
      const tree = await classTree(q, ctx);
      const cls = tree.resolve(String(row.class));
      const facts = [
        `کلاس: ${tree.label(String(row.class))}`,
        row.environment ? `محیط: ${label(CI_ENVIRONMENTS, row.environment)}` : "",
        row.criticality ? `اهمیت: ${label(CI_CRITICALITY, row.criticality)}` : "",
        row.manufacturer || row.model_name ? `سازنده و مدل: ${[row.manufacturer, row.model_name].filter(Boolean).join(" ")}` : "",
        row.os ? `سیستم‌عامل: ${[row.os, row.os_version].filter(Boolean).join(" ")}` : "",
        row.hostname || row.fqdn ? `نام میزبان: ${row.fqdn ?? row.hostname}` : "",
        row.ip_address ? `نشانی IP: ${row.ip_address}` : "",
        row.sw_version ? `نسخه: ${row.sw_version}` : "",
      ].filter(Boolean);
      const attrs = (row.attrs ?? {}) as Record<string, unknown>;
      for (const a of cls?.allAttrs ?? []) {
        const v = attrs[a.name];
        if (v === null || v === undefined || v === "") continue;
        const shown = a.choices ? (Array.isArray(v) ? v.map((x) => label(a.choices!, x)).join("، ") : label(a.choices, v)) : Array.isArray(v) ? v.join("، ") : String(v);
        facts.push(`${a.label}: ${shown}${a.unit ? ` ${a.unit}` : ""}`);
      }
      const parts = [{ field: "class", label: "مشخصات", text: facts.join("\n"), group: null, format: "text" as const }];
      if (row.description) parts.push({ field: "description", label: "شرح", text: String(row.description), group: null, format: "markdown" as never });
      return { title: String(row.name ?? ""), titleField: "name", number: (row.number as string) ?? null, parts };
    },
  });
}
