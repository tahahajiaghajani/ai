// Helpers of the continuity module: reads through the access rule (re-used from incident management) and the settings.
import { CONTINUITY_CONFIG_DEFAULTS, type ContinuityConfig } from "@shared/tables/continuity";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { liveRows, liveRow, isUuid, sysOf, eqAll, type Row } from "../incident/common";
import { orgTz } from "../../engine";

export { liveRows, liveRow, isUuid, sysOf, eqAll, orgTz, type Row };

/** The organisation's continuity settings (its row, else the defaults). */
export async function continuityConfig(q: Queryable, ctx: Ctx): Promise<ContinuityConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "continuity_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...CONTINUITY_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(CONTINUITY_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return { ...(out as unknown as ContinuityConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

export const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
