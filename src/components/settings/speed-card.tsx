"use client";
import * as React from "react";
import { toast } from "sonner";
import { Gauge } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { speedCheckAction } from "@/app/actions/admin";
import { SUPABASE_TO_VERCEL } from "@/lib/regions";
import { cn, faNum } from "@/lib/utils";
import type { SpeedReport } from "@/lib/speed";

const VERDICT: Record<SpeedReport["verdict"], { label: string; tone: string }> = {
  good: { label: "خوب — سرور اپ و دیتابیس نزدیک هم‌اند", tone: "text-success" },
  slow: { label: "کند — احتمالاً سرور اپ (Vercel) و دیتابیس (Supabase) در دو منطقه‌ی مختلف‌اند", tone: "text-warning" },
  "very-slow": { label: "بسیار کند — سرور اپ و دیتابیس از هم دورند؛ هر کلیک چند برابر این عدد طول می‌کشد", tone: "text-danger" },
};

/** Settings card: measures server ↔ Supabase/GitHub latency and explains how to fix a region mismatch. */
export function SpeedCard() {
  const [report, setReport] = React.useState<SpeedReport | null>(null);
  const [busy, setBusy] = React.useState(false);
  const check = async () => {
    setBusy(true);
    const r = await speedCheckAction();
    setBusy(false);
    if (r.ok) setReport(r.data);
    else toast.error(r.error);
  };
  return (
    <Card>
      <CardHeader
        title="سرعت و منطقه‌ی سرور"
        subtitle="هر صفحه و هر دکمه چند بار با دیتابیس رفت‌وبرگشت دارد؛ فاصله‌ی سرور Vercel تا Supabase مهم‌ترین عامل سرعت است"
        icon={<Gauge className="size-4" />}
        actions={
          <Button size="sm" variant="secondary" loading={busy} onClick={check}>
            اندازه‌گیری
          </Button>
        }
      />
      <div className="space-y-3 p-5 text-sm leading-7">
        {report ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-muted/60 p-3">
                <p className="text-xs text-muted">منطقه‌ی سرور اپ (Vercel)</p>
                <p className="ltr text-start font-mono font-bold">{report.region ?? "—"}</p>
              </div>
              <div className="rounded-xl bg-surface-muted/60 p-3">
                <p className="text-xs text-muted">هر درخواست به Supabase</p>
                <p className="font-bold">{faNum(report.supabaseMs)} میلی‌ثانیه</p>
              </div>
              <div className="rounded-xl bg-surface-muted/60 p-3">
                <p className="text-xs text-muted">هر درخواست به GitHub</p>
                <p className="font-bold">{report.githubMs === null ? "—" : `${faNum(report.githubMs)} میلی‌ثانیه`}</p>
              </div>
            </div>
            <p className={cn("font-bold", VERDICT[report.verdict].tone)}>{VERDICT[report.verdict].label}</p>
            {report.verdict !== "good" ? (
              <div className="rounded-xl border border-line p-3 text-xs leading-6">
                <p className="font-bold">راه‌حل (یک بار، بدون هزینه):</p>
                <ol className="mt-1 list-decimal space-y-1 ps-5">
                  <li>در Supabase منطقه‌ی پروژه را ببینید: Project Settings ← General (مثلاً Frankfurt یا eu-central-1).</li>
                  <li>در Vercel: پروژه ← Settings ← Functions ← Function Region را روی منطقه‌ی معادل از جدول زیر بگذارید و Save بزنید.</li>
                  <li>یک Redeploy بزنید (Deployments ← آخرین مورد ← Redeploy) و دوباره «اندازه‌گیری» کنید؛ عدد باید زیر ۱۰–۲۰ میلی‌ثانیه بیاید.</li>
                </ol>
                <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                  {SUPABASE_TO_VERCEL.map((r) => (
                    <span key={r.supabase} className="ltr text-start font-mono text-[11px] text-muted">
                      {r.label} ({r.supabase}) → <b className="text-fg">{r.vercel}</b>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {report.legacyJwt ? (
              <p className="rounded-xl bg-amber-500/10 p-3 text-xs leading-6">
                پروژه‌ی Supabase هنوز از کلید JWT قدیمی (Legacy) استفاده می‌کند، پس بررسی ورود در هر کلیک یک درخواست اضافه به Supabase می‌فرستد. در Supabase: Project Settings ← JWT Keys ← «Migrate JWT secret» و سپس «Rotate keys» را بزنید تا بررسی ورود محلی و فوری انجام شود.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted">«اندازه‌گیری» را بزنید تا فاصله‌ی سرور اپ تا دیتابیس و GitHub سنجیده شود.</p>
        )}
      </div>
    </Card>
  );
}
