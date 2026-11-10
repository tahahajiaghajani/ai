// The OpenAPI 3.1 document of the record API (catalogue INT-001), generated from the effective table definitions an
// integration user may use: only the tables it may read, only the fields it may see, only the operations its roles and
// its key's scopes allow, with the organisation's custom fields and choice lists. Pure — the server feeds it the
// caller's view of the registry (its own access), the hub's «مستندات API» page shows the same document.
// Imported by the UI: keep it free of server imports.
import type { FieldDef, Option } from "../model/types";
import type { ApiOp } from "./scopes";

export interface ApiTable {
  key: string;
  label: string;
  plural: string;
  description?: string | null;
  numbered: boolean;
  fields: FieldDef[];
  /** state model: the state field and its options */
  states?: { field: string; options: { value: string; label: string }[] } | null;
  ops: ApiOp[];
}

export interface OpenApiInput {
  title: string;
  version: string;
  /** e.g. https://host/api/v1 */
  server: string;
  tables: ApiTable[];
  /** choice lists by key (the organisation's options) */
  choices: Record<string, Option[]>;
}

type Schema = Record<string, unknown>;

const INPUT_EXCLUDED = (f: FieldDef) => !!(f.system || f.readonly || f.base);

/** The JSON schema of one field's value as the API returns it. */
export function fieldSchema(f: FieldDef, choices: Record<string, Option[]>): Schema {
  const desc = [f.label, f.help].filter(Boolean).join(" — ");
  const base: Schema = { description: desc };
  const opts = Array.isArray(f.choices) ? f.choices : typeof f.choices === "string" ? choices[f.choices] ?? [] : [];
  switch (f.type) {
    case "int":
    case "rating":
    case "duration":
      return { ...base, type: ["integer", "null"] };
    case "decimal":
    case "money":
    case "percent":
      return { ...base, type: ["string", "null"], pattern: "^-?\\d+(\\.\\d+)?$", "x-format": "decimal" };
    case "bool":
      return { ...base, type: "boolean" };
    case "date":
      return { ...base, type: ["string", "null"], format: "date" };
    case "datetime":
      return { ...base, type: ["string", "null"], format: "date-time" };
    case "choice":
    case "color":
      return { ...base, type: ["string", "null"], ...(opts.length ? { enum: [...opts.map((o) => o.value), null] } : {}) };
    case "multichoice":
      return { ...base, type: "array", items: { type: "string", ...(opts.length ? { enum: opts.map((o) => o.value) } : {}) } };
    case "tags":
      return { ...base, type: "array", items: { type: "string" } };
    case "ref":
    case "user":
    case "group":
      return { ...base, type: ["string", "null"], format: "uuid", ...(f.ref ? { "x-ref": f.ref } : {}) };
    case "refs":
    case "users":
      return { ...base, type: "array", items: { type: "string", format: "uuid" }, ...(f.ref ? { "x-ref": f.ref } : {}) };
    case "email":
      return { ...base, type: ["string", "null"], format: "email" };
    case "url":
      return { ...base, type: ["string", "null"], format: "uri" };
    case "json":
    case "conditions":
      return { ...base };
    case "secret":
      return { ...base, type: ["object", "string", "null"], description: `${desc} (فقط نوشتنی؛ هرگز برگردانده نمی‌شود)` };
    default:
      return { ...base, type: ["string", "null"], ...(f.maxLength ? { maxLength: f.maxLength } : {}) };
  }
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema) => ({ "application/json": { schema } });
const ok = (schema: Schema, description = "موفق") => ({ description, content: json(schema) });
const err = { $ref: "#/components/responses/Error" };
const ERRORS = { "400": err, "401": err, "403": err, "404": err, "409": err, "429": err };

const pascal = (key: string) => key.replace(/(^|_)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

/** The OpenAPI 3.1 document. */
export function buildOpenApi(input: OpenApiInput): Schema {
  const schemas: Record<string, Schema> = {
    Error: {
      type: "object",
      properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string", description: "پیام فارسی" }, details: {} }, required: ["code", "message"] } },
    },
    Display: { type: "object", additionalProperties: { type: "string" }, description: "برچسب نمایشی هر شناسهٔ ارجاع‌شده" },
    Condition: { description: "شرط به زبان یکپارچهٔ شرط‌ها: { f, op, v } یا { and: [...] } / { or: [...] }" },
    Query: {
      type: "object",
      properties: {
        filter: ref("Condition"),
        q: { type: "string", description: "جست‌وجوی متنی یا شمارهٔ رکورد" },
        sort: { type: "string", description: "مانند -updated_at,number" },
        page: { type: "integer", minimum: 1 },
        size: { type: "integer", minimum: 1, maximum: 200 },
        fields: { type: "array", items: { type: "string" } },
      },
    },
  };
  const paths: Record<string, Record<string, unknown>> = {};
  const tags: { name: string; description: string }[] = [];
  for (const t of [...input.tables].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!t.ops.includes("read")) continue;
    const name = pascal(t.key);
    const props: Record<string, Schema> = { id: { type: "string", format: "uuid" }, version: { type: "integer", description: "نشانهٔ هم‌زمانی؛ برای تغییر بفرستید" } };
    if (t.numbered) props.number = { type: "string", description: "شمارهٔ رکورد" };
    const input_: Record<string, Schema> = {};
    const required: string[] = [];
    for (const f of t.fields) {
      if (f.name === "number") continue;
      props[f.name] = fieldSchema(f, input.choices);
      if (!INPUT_EXCLUDED(f) && f.type !== "secret" && !(t.states && f.name === t.states.field)) {
        input_[f.name] = fieldSchema(f, input.choices);
        if (f.required && f.default === undefined) required.push(f.name);
      }
    }
    schemas[name] = { type: "object", title: t.label, description: t.description ?? t.plural, properties: props };
    schemas[`${name}Input`] = { type: "object", title: `${t.label} (ورودی)`, properties: input_, ...(required.length ? { required } : {}), additionalProperties: false };
    tags.push({ name: t.key, description: `${t.plural}${t.description ? ` — ${t.description}` : ""}` });
    const base = `/r/${t.key}`;
    const item = `/r/${t.key}/{id}`;
    const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
    const listResp = ok({ type: "object", properties: { rows: { type: "array", items: ref(name) }, total: { type: ["integer", "null"] }, page: { type: "integer" }, size: { type: "integer" }, display: ref("Display") } });
    const oneResp = ok({ type: "object", properties: { row: ref(name), display: ref("Display"), meta: { type: "object" } } });
    paths[base] = {
      get: {
        tags: [t.key],
        summary: `فهرست ${t.plural}`,
        operationId: `list_${t.key}`,
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "filter", in: "query", schema: { type: "string" }, description: "شرط به صورت JSON" },
          { name: "sort", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "size", in: "query", schema: { type: "integer", maximum: 200 } },
          { name: "fields", in: "query", schema: { type: "string" }, description: "نام فیلدها با کاما" },
        ],
        responses: { "200": listResp, ...ERRORS },
      },
      ...(t.ops.includes("create")
        ? { post: { tags: [t.key], summary: `ثبت ${t.label}`, operationId: `create_${t.key}`, requestBody: { required: true, content: json(ref(`${name}Input`)) }, responses: { "200": oneResp, ...ERRORS } } }
        : {}),
    };
    paths[`${base}/query`] = { post: { tags: [t.key], summary: `جست‌وجوی ${t.plural}`, operationId: `query_${t.key}`, requestBody: { content: json(ref("Query")) }, responses: { "200": listResp, ...ERRORS } } };
    paths[item] = {
      get: { tags: [t.key], summary: `خواندن ${t.label}`, operationId: `get_${t.key}`, parameters: [idParam], responses: { "200": oneResp, ...ERRORS } },
      ...(t.ops.includes("update")
        ? {
            patch: {
              tags: [t.key],
              summary: `تغییر ${t.label}`,
              operationId: `update_${t.key}`,
              parameters: [idParam, { name: "If-Match", in: "header", schema: { type: "string" }, description: "نسخهٔ رکورد" }],
              requestBody: { required: true, content: json({ allOf: [{ ...ref(`${name}Input`) }], properties: { version: { type: "integer" } } }) },
              responses: { "200": oneResp, ...ERRORS },
            },
          }
        : {}),
      ...(t.ops.includes("delete")
        ? { delete: { tags: [t.key], summary: `حذف ${t.label}`, operationId: `delete_${t.key}`, parameters: [idParam, { name: "version", in: "query", schema: { type: "integer" } }], responses: { "200": ok({ type: "object", properties: { ok: { type: "boolean" } } }), ...ERRORS } } }
        : {}),
    };
    if (t.states && t.ops.includes("update")) {
      paths[`${item}/transition`] = {
        post: {
          tags: [t.key],
          summary: `تغییر وضعیت ${t.label}`,
          operationId: `transition_${t.key}`,
          parameters: [idParam],
          requestBody: { required: true, content: json({ type: "object", properties: { to: { type: "string", enum: t.states.options.map((o) => o.value) }, data: { type: "object" }, version: { type: "integer" } }, required: ["to"] }) },
          responses: { "200": oneResp, ...ERRORS },
        },
      };
    }
    paths[`${item}/journal`] = {
      get: { tags: [t.key], summary: "یادداشت‌ها و پاسخ‌ها", operationId: `journal_${t.key}`, parameters: [idParam], responses: { "200": ok({ type: "object" }), ...ERRORS } },
      ...(t.ops.includes("update")
        ? { post: { tags: [t.key], summary: "افزودن پاسخ یا یادداشت", operationId: `comment_${t.key}`, parameters: [idParam], requestBody: { content: json({ type: "object", properties: { kind: { type: "string", enum: ["comment", "work_note"] }, body: { type: "string" } }, required: ["body"] }) }, responses: { "200": ok({ type: "object" }), ...ERRORS } } }
        : {}),
    };
    paths[`${item}/history`] = { get: { tags: [t.key], summary: "تاریخچهٔ تغییرها", operationId: `history_${t.key}`, parameters: [idParam], responses: { "200": ok({ type: "object" }), ...ERRORS } } };
  }
  return {
    openapi: "3.1.0",
    info: { title: input.title, version: input.version, description: "API رکوردها با دسترسی همین کاربر یکپارچه‌سازی؛ فقط جدول‌ها، فیلدها و عملیاتی که او مجاز است در این سند آمده‌اند." },
    servers: [{ url: input.server }],
    security: [{ bearer: [] }],
    tags,
    paths,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "کلید API کاربر یکپارچه‌سازی (sm_…)" } },
      responses: { Error: { description: "خطا (پیام فارسی)", content: json(ref("Error")) } },
      schemas,
    },
  };
}
