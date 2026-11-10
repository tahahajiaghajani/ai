// The band above the top bar of an organisation:
// - for the platform admin in «حالت پشتیبانی»: the level, the reason, the time left and «پایان حالت پشتیبانی»
//   (when the time runs out he is taken back to the organisation's page in «مدیریت سامانه»);
// - for members of an organisation the platform admin made read-only: the status and its reason.
import { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import { FlaskConical, LifeBuoy, Lock } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useNotify } from "../../lib/hooks";
import { api } from "../../lib/api";
import { faDigits } from "@shared/format";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** «۳ ساعت و ۱۲ دقیقه» / «۸ دقیقه» / «کمتر از یک دقیقه». */
export function timeLeft(ms: number): string {
  if (ms < 60_000) return "کمتر از یک دقیقه";
  const total = Math.floor(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${faDigits(m)} دقیقه`;
  return m ? `${faDigits(h)} ساعت و ${faDigits(m)} دقیقه` : `${faDigits(h)} ساعت`;
}

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every]);
  return now;
}

function SupportBand() {
  const { support, orgId, info } = useOrg();
  const { refresh } = useSession();
  const qc = useQueryClient();
  const n = useNotify();
  const nav = useNavigate();
  const now = useNow(15_000);
  const [ending, setEnding] = useState(false);
  const left = support ? new Date(support.expires_at).getTime() - now : 0;
  const back = async () => {
    await refresh();
    nav(`/admin/orgs/${orgId}`, { replace: true });
    qc.removeQueries({ queryKey: ["org", orgId] });
  };

  useEffect(() => {
    if (support && left <= 0) {
      n.info("زمان حالت پشتیبانی به پایان رسید.");
      void back();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [support, left <= 0]);

  if (!support) return null;
  const end = async () => {
    setEnding(true);
    try {
      await api.post(`/admin/support/${support.id}/end`);
      n.ok("حالت پشتیبانی پایان یافت.");
      await back();
    } catch (e) {
      n.error(e);
      setEnding(false);
    }
  };
  const readOnly = info.status && info.status.status !== "active";
  return (
    <div
      role="status"
      className="no-print flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ds-warning-border)] bg-warning-tint px-4 py-1.5 text-[13px] leading-5 text-ink"
    >
      <span className="inline-flex items-center gap-2 font-semibold text-warning">
        <LifeBuoy {...ICON} aria-hidden />
        حالت پشتیبانی
      </span>
      <span className="text-ink-2">{support.level_title}</span>
      {readOnly ? <span className="text-ink-2">· سازمان {info.status!.status === "suspended" ? "معلق" : "فقط‌خواندنی"} است</span> : null}
      <Tooltip title={support.reason}>
        <span className="min-w-0 max-w-[36ch] truncate text-ink-3 max-sm:hidden">دلیل: {support.reason}</span>
      </Tooltip>
      <span className="ms-auto inline-flex items-center gap-3">
        <span className="text-ink-2">
          <span className="ds-num">{timeLeft(Math.max(0, left))}</span> مانده
        </span>
        <Button size="small" onClick={end} loading={ending}>
          پایان حالت پشتیبانی
        </Button>
      </span>
    </div>
  );
}

function StatusBand() {
  const { info, support } = useOrg();
  const s = info.status;
  if (support || !s || s.status === "active") return null;
  return (
    <div role="status" className="no-print flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-neutral-tint px-4 py-1.5 text-[13px] leading-5 text-ink">
      <span className="inline-flex items-center gap-2 font-semibold">
        <Lock {...ICON} aria-hidden />
        {s.status === "suspended" ? "این سازمان معلق است" : "این سازمان فقط‌خواندنی است"}
      </span>
      <span className="text-ink-2">{s.reason ? `دلیل: ${s.reason}` : "تغییر تازه ثبت نمی‌شود؛ برای پیگیری با پشتیبانی تماس بگیرید."}</span>
    </div>
  );
}

/** «این سازمان دادهٔ نمایشی دارد» while the demo pack is loaded (docs/DEMO_FA.md), on every page of the organisation. */
function DemoBand() {
  const { api, orgId, can } = useOrg();
  const q = useQuery({
    queryKey: ["demo-banner", orgId],
    queryFn: () => api.get<{ active: boolean; state: string; bank: string }>("/demo/banner"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  if (!q.data?.active) return null;
  return (
    <div role="status" className="no-print flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ds-info-border)] bg-[var(--ds-info-tint)] px-4 py-1 text-[13px] leading-5 text-ink">
      <span className="inline-flex items-center gap-2 font-semibold text-[var(--ds-info)]">
        <FlaskConical {...ICON} aria-hidden />
        این سازمان دادهٔ نمایشی دارد
      </span>
      <span className="text-ink-2 max-sm:hidden">{q.data.bank} — همهٔ نام‌ها و رکوردهای آن ساختگی است.</span>
      {can("settings", "full") ? (
        <Link className="ms-auto" to={`/${orgId}/settings/demo`}>
          مدیریت داده‌های نمایشی
        </Link>
      ) : null}
    </div>
  );
}

export function SupportBanner() {
  return (
    <>
      <SupportBand />
      <StatusBand />
      <DemoBand />
    </>
  );
}
