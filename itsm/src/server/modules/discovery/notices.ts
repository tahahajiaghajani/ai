// Notices to a connector's owner (design A §7.5, §10.4): the person answerable for a connector (`owner_id`) is told
// when its tool keeps failing — after three failed inventory passes in a row — and when the mass-drop guard holds a pass.
// In the app and by e-mail, mandatory; a demo connector's stay inside the system (the notify module's demo rules).
import type { Queryable } from "../../db";
import { notifyPeople } from "../notify";

const faNum = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** Failed passes in a row after which the owner is told (once, when the count reaches it). */
export const FAILURES_NOTICE = 3;

async function owner(q: Queryable, orgId: string, connectorId: string): Promise<{ name: string; owner_id: string | null } | null> {
  return q.one<{ name: string; owner_id: string | null }>(`select name, owner_id from sm_discovery_connectors where org_id = $1 and id = $2`, [orgId, connectorId]);
}

async function tell(q: Queryable, orgId: string, connectorId: string, subject: (name: string) => string, body: (name: string) => string): Promise<boolean> {
  const c = await owner(q, orgId, connectorId);
  if (!c?.owner_id) return false;
  await notifyPeople(q, orgId, {
    table: "discovery_connector", id: connectorId, users: [c.owner_id], subject: subject(c.name), body: body(c.name), short_text: subject(c.name),
    label: "منبع داده", source: "منبع‌های داده", channels: ["in_app", "email"], mandatory: true,
  });
  return true;
}

/** «… سه بار پیاپی ناموفق بود» (§7.5). */
export function noticeFailures(q: Queryable, orgId: string, connectorId: string, error: string): Promise<boolean> {
  return tell(
    q, orgId, connectorId,
    (name) => `منبع دادهٔ «${name}» ${faNum(FAILURES_NOTICE)} بار پیاپی ناموفق بود`,
    (name) => `آخرین خطا: ${error.slice(0, 300)}\nنشانی ابزار، کلید و دسترسی حساب منبع «${name}» را بررسی کنید و «آزمودن اتصال» را بزنید؛ منبع خاموش نشده است و در زمان بعدی دوباره اجرا می‌شود.`,
  );
}

/** «کاهش ناگهانی» (§10.4): nothing was set aside; the owner decides whether the new size is right. */
export function noticeMassDrop(q: Queryable, orgId: string, connectorId: string, listed: number, before: number): Promise<boolean> {
  return tell(
    q, orgId, connectorId,
    (name) => `کاهش ناگهانی در فهرست منبع دادهٔ «${name}»`,
    (name) =>
      `گذر کامل تازهٔ «${name}» ${faNum(listed)} مورد فهرست کرد، در برابر ${faNum(before)} مورد گذر کامل پیشین. هیچ موردی کنار گذاشته نشد و کهنگی بررسی نشد.\n` +
      `اگر ابزار یا دسترسی حسابش درست است و اندازهٔ تازه درست است، «پذیرش اندازهٔ تازه» را در صفحهٔ منبع بزنید.`,
  );
}
