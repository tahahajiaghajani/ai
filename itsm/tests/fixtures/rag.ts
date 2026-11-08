// A stand-in indexed ITSM table for the retrieval tests: an incident-like task in area "incident" with confidential
// rows and text fields in several field groups — public description and resolution, an internal diagnosis, an HR note,
// and an ai_private note that must never be indexed — declared as its RAG document (`ai`). Import it at the top of a
// test file, before the first server is made.
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";

export const RAG_TICKET: TableDef = registerTable({
  key: "rag_ticket",
  table: "sm_rag_tickets",
  label: "تیکت آزمایشی",
  plural: "تیکت‌های آزمایشی",
  icon: "ticket",
  module: "test",
  area: "incident",
  extends: "task",
  numbered: { prefix: "RAG", pad: 5 },
  display: "short_description",
  fields: [
    { name: "diagnosis", label: "تشخیص داخلی", type: "text", group: "internal" },
    { name: "salary_note", label: "یادداشت حقوق", type: "text", group: "hr" },
    { name: "private_note", label: "یادداشت خصوصی هوش مصنوعی", type: "text", group: "ai_private", ai: { index: true } },
    { name: "token", label: "رمز", type: "secret" },
    { name: "national_code", label: "کد ملی", type: "string", ai: { index: true, redact: true } },
  ],
  scope: {},
  features: { confidential: true, rag: true },
  ai: { title: "short_description", text: ["description", "diagnosis", "salary_note", "close_notes"] },
  list: { columns: ["number", "short_description", "state"], order: "-updated_at" },
});
