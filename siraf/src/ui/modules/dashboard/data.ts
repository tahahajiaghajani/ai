// Data of «پیشخوان»: the period control, the cash-and-bank daily series behind the hero chart and the period's
// income statement. The series is rebuilt from the ledgers of the cash, petty-cash and bank accounts of the current
// fiscal year (one request each) and aligned to the dashboard's own total, so the chart and the figure always agree.
import { useQueries, useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { addDays, diffDays, todayISO, weekday, WEEKDAYS_SHORT } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { num } from "./kit";

export const PERIODS = ["today", "week", "month", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = { today: "امروز", week: "هفته", month: "ماه", quarter: "فصل", year: "سال" };

export interface PeriodSpec {
  key: Period;
  /** length of the period in days (1 for today) */
  days: number;
  from: string;
  to: string;
  /** the same length just before it */
  prevFrom: string;
  prevTo: string;
  /** «۷ روز اخیر», «سال مالی» … — the period as a phrase for titles */
  phrase: string;
  /** «نسبت به ۷ روز پیش از آن» … */
  vs: string;
  /** days drawn by the hero chart (at least a week) */
  chartDays: number;
}

const faN = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

export function periodSpec(p: Period, today: string, fyStart?: string | null): PeriodSpec {
  let days = p === "today" ? 1 : p === "week" ? 7 : p === "month" ? 30 : p === "quarter" ? 90 : 365;
  if (p === "year" && fyStart && fyStart <= today) days = diffDays(today, fyStart) + 1;
  days = Math.max(1, days);
  const from = addDays(today, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const phrase = p === "today" ? "امروز" : p === "year" ? "سال مالی" : `${faN(days)} روز اخیر`;
  const vs = p === "today" ? "نسبت به دیروز" : p === "year" ? "نسبت به همین مدت پیش از آن" : `نسبت به ${faN(days)} روز پیش از آن`;
  return { key: p, days, from, to: today, prevFrom, prevTo, phrase, vs, chartDays: Math.max(7, days) };
}

export interface DayPoint {
  date: string;
  v: number;
}

interface Account {
  id: string;
  parent_id: string | null;
  system_key: string | null;
}

const CASH_KEYS = ["cash", "petty_cash", "bank"];

/**
 * Daily cash + bank balances for the last `2 × chartDays` days, from the ledger of each cash/bank account of the
 * current fiscal year. Returns `null` while loading, `undefined` when unavailable (no permission, or a ledger
 * too long to draw).
 */
export function useCashSeries(spec: PeriodSpec, endTotal: number | null) {
  const { api, orgId, can, info, org } = useOrg();
  const today = todayISO(org.settings?.timezone || "Asia/Tehran");
  const fy = info.fiscal_years.find((f) => f.start_date <= today && f.end_date >= today) ?? null;
  const allowed = can("accounting", "view") && can("reports", "view");
  const accounts = useQuery({
    queryKey: ["dash-cash-accounts", orgId],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounting/accounts").then((r) => r.accounts),
    enabled: allowed,
    staleTime: 5 * 60_000,
  });
  const ids = useMemo(() => {
    const list = accounts.data ?? [];
    const keyed = list.filter((a) => a.system_key && CASH_KEYS.includes(a.system_key));
    const set = new Set(keyed.map((a) => a.id));
    const byId = new Map(list.map((a) => [a.id, a]));
    // a ledger covers the account's subtree: drop accounts whose ancestor is already in the set
    return keyed
      .filter((a) => {
        let p = a.parent_id ? byId.get(a.parent_id) : undefined;
        while (p) {
          if (set.has(p.id)) return false;
          p = p.parent_id ? byId.get(p.parent_id) : undefined;
        }
        return true;
      })
      .map((a) => a.id);
  }, [accounts.data]);
  const span = spec.chartDays * 2;
  const from = addDays(today, -(span - 1));
  const ledgers = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["dash-cash-ledger", orgId, id, from, today, fy?.id ?? null],
      queryFn: () =>
        api.get<{ opening: string; rows: { date: string; balance: string }[]; truncated: boolean }>("/accounting/reports/ledger", {
          account_id: id,
          from,
          to: today,
          fiscal_year_id: fy?.id,
        }),
      staleTime: 60_000,
      refetchInterval: 120_000,
      placeholderData: keepPreviousData,
    })),
  });

  return useMemo(() => {
    if (!allowed || accounts.isError) return undefined;
    if (accounts.isLoading || ledgers.some((l) => l.isLoading)) return null;
    if (!ids.length || ledgers.some((l) => l.isError || !l.data || l.data.truncated)) return undefined;
    const days: string[] = Array.from({ length: span }, (_, i) => addDays(from, i));
    const total = days.map(() => 0);
    for (const l of ledgers) {
      const d = l.data!;
      let bal = num(d.opening);
      let r = 0;
      const rows = d.rows;
      days.forEach((day, i) => {
        while (r < rows.length && String(rows[r].date).slice(0, 10) <= day) {
          bal = num(rows[r].balance);
          r++;
        }
        total[i] += bal;
      });
    }
    // align to the dashboard's total (the same accounts, read by system key), so the end point is today's figure
    const off = endTotal !== null && Number.isFinite(endTotal) ? endTotal - total[span - 1] : 0;
    const all: DayPoint[] = days.map((date, i) => ({ date, v: total[i] + off }));
    // the previous window is only meaningful inside the fiscal year (the ledger is read per fiscal year)
    const compareOk = !fy || from >= fy.start_date;
    return { current: all.slice(spec.chartDays), previous: compareOk ? all.slice(0, spec.chartDays) : [], fyStart: fy?.start_date ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, accounts.isError, accounts.isLoading, ids, ledgers.map((l) => l.dataUpdatedAt).join(","), span, from, endTotal, spec.chartDays]);
}

/** The income statement of the period and of the same length just before it. */
export function usePeriodPL(spec: PeriodSpec) {
  const { api, orgId, can } = useOrg();
  const enabled = can("reports", "view");
  const get = (from: string, to: string) =>
    api.get<{ total_income: string; total_expense: string; net: string }>("/accounting/reports/income-statement", { from, to });
  const cur = useQuery({ queryKey: ["dash-pl", orgId, spec.from, spec.to], queryFn: () => get(spec.from, spec.to), enabled, placeholderData: keepPreviousData, refetchInterval: 120_000 });
  const prev = useQuery({ queryKey: ["dash-pl", orgId, spec.prevFrom, spec.prevTo], queryFn: () => get(spec.prevFrom, spec.prevTo), enabled, placeholderData: keepPreviousData, staleTime: 5 * 60_000 });
  return { cur: cur.data, prev: prev.data, loading: cur.isLoading, fetching: cur.isFetching && !cur.isLoading };
}

/** The seven days from today: weekday initial, ISO date and whether it is today. */
export function nextSevenDays(today: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    return { date, initial: WEEKDAYS_SHORT[weekday(date)], today: i === 0 };
  });
}
