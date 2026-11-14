// Linking a standalone Windows app to a web version or server is refused while its organisation has open cases
// (design F §7.2, package F4b): runs are not rebuilt on the authority in version 1. The desktop's link flow asks this
// before an upload (src/desktop/sync-client.ts); the upload rule (./upload.ts) is the second guard.
import { faDigits } from "@shared/format";
import type { Queryable } from "../../../db";

/** «در جریان»، «در انتظار»، «نیاز به بررسی» */
export const OPEN_CASE_STATES = ["active", "waiting", "attention"];

/** «پیش از پیوستن، ۳ پروندهٔ باز گردش‌کار را …» — null when the organisation has no open case. */
export async function openCasesRefusal(q: Queryable, orgId: string): Promise<string | null> {
  const r = await q.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and deleted_at is null and state = any($2::text[])`, [orgId, `{${OPEN_CASE_STATES.join(",")}}`]);
  const n = Number(r?.n ?? 0);
  return n > 0 ? `پیش از پیوستن، ${faDigits(n)} پروندهٔ باز گردش‌کار را به پایان برسانید یا لغو کنید` : null;
}
