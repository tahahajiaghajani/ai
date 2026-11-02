// Fiscal years: every dated document belongs to the open fiscal year that contains its date.
import type { Queryable } from "../../db";
import { bad } from "../../http/errors";
import { formatJalali } from "@shared/jalali";

export interface FiscalYear {
  id: string;
  org_id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: "open" | "closing" | "closed";
}

export async function fiscalYearFor(q: Queryable, orgId: string, date: string, opts: { allowClosed?: boolean } = {}): Promise<FiscalYear> {
  const fy = await q.one<FiscalYear>(
    `select id, org_id, title, start_date, end_date, status from tz_fiscal_years
     where org_id = $1 and deleted_at is null and start_date <= $2 and end_date >= $2
     order by start_date desc limit 1`,
    [orgId, date],
  );
  if (!fy) throw bad(`برای تاریخ ${formatJalali(date)} سال مالی تعریف نشده است (تنظیمات ← سال‌های مالی)`);
  if (fy.status === "closed" && !opts.allowClosed) throw bad(`سال مالی ${fy.title} بسته شده است و سند جدید نمی‌پذیرد`);
  return fy;
}

export async function listFiscalYears(q: Queryable, orgId: string): Promise<FiscalYear[]> {
  return q.query<FiscalYear>(
    `select id, org_id, title, start_date, end_date, status from tz_fiscal_years
     where org_id = $1 and deleted_at is null order by start_date desc`,
    [orgId],
  );
}
