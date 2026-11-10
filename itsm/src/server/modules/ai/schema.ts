// Tool and output schemas: zod → JSON schema for the providers. The JSON schema only guides the
// model; every input is validated again with the zod schema before a tool runs.
import { z } from "zod";

/** JSON schema of a zod object, without `$schema`, as the input side (defaults optional). */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  let out: Record<string, unknown>;
  try {
    out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  } catch {
    out = { type: "object" };
  }
  delete out.$schema;
  if (out.type !== "object") out = { type: "object", properties: {} };
  if (!out.properties) out.properties = {};
  return out;
}

/** Gemini accepts a JSON-schema subset: drop keywords it rejects (they are enforced by zod anyway). */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "$schema" || k === "additionalProperties" || k === "$id" || k === "default" || k === "examples") continue;
    out[k] = geminiSchema(v);
  }
  return out;
}

/** OpenAI-style strict schema: every property required (optional ones become nullable), no extras. */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const s = { ...(schema as Record<string, unknown>) };
  for (const key of ["items", "anyOf", "oneOf", "allOf", "prefixItems"]) if (s[key]) s[key] = strictSchema(s[key]);
  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    const props = s.properties as Record<string, Record<string, unknown>>;
    const required = new Set((s.required as string[] | undefined) ?? []);
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      const sub = strictSchema(v) as Record<string, unknown>;
      next[k] = required.has(k) ? sub : { anyOf: [sub, { type: "null" }] };
    }
    s.properties = next;
    s.required = Object.keys(props);
    s.additionalProperties = false;
  }
  return s;
}

/** Remove nulls that a strict-schema model sent for optional fields, so zod's optional() accepts them. */
export function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== null) out[k] = dropNulls(x);
  return out;
}
