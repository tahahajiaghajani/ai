import type { ReactNode } from "react";
import { CheckCircleFilled } from "@ant-design/icons";
import { Logo } from "../../components/layout";
import { APP_NAME } from "@shared/constants";
import { useSession } from "../../lib/session";
import { faDigits } from "@shared/format";

const POINTS = [
  "حسابداری دوطرفه با کدینگ استاندارد، سند خودکار و ترازنامه",
  "انبار، خرید و فروش، چک و خزانه‌داری کامل",
  "طلا و جواهر: اتیکت، اجرت، آبشده و حساب وزنی",
  "صرافی نقدی و دیجیتال: حواله، کیف‌پول و قیمت زنده",
  "نسخه‌ی ویندوز آفلاین و وب، هم‌گام با هم",
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { meta } = useSession();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="m-0 text-2xl font-extrabold">{title}</h1>
          {subtitle ? <p className="mb-6 mt-2 text-sm text-muted">{subtitle}</p> : <div className="mb-6" />}
          {children}
          <div className="mt-10 text-center text-[11px] text-muted">
            {APP_NAME} · {meta?.mode === "desktop" ? "نسخه‌ی ویندوز" : "نسخه‌ی وب"} {faDigits(meta?.version ?? "")}
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block" style={{ background: "radial-gradient(1200px 600px at 20% 10%, #13a3c455, transparent 60%), radial-gradient(900px 500px at 90% 90%, #b8862f44, transparent 60%), linear-gradient(160deg, #0b1f33, #071321)" }}>
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Logo light />
          <div>
            <div className="text-4xl font-extrabold leading-[1.4]">
              دفترهای کسب‌وکارتان،
              <br />
              <span style={{ color: "#e9c46a" }}>همیشه تراز.</span>
            </div>
            <ul className="mt-8 space-y-3 p-0">
              {POINTS.map((p) => (
                <li key={p} className="flex list-none items-center gap-3 text-[15px] text-[#c7d3e0]">
                  <CheckCircleFilled style={{ color: "#13a3c4" }} /> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-xs text-[#8aa0b6]">ساخته‌شده برای کسب‌وکارهای فارسی‌زبان — تقویم شمسی، مالیات ۱۴۰۵، سامانه‌ی مؤدیان و چک صیادی</div>
        </div>
      </div>
    </div>
  );
}
