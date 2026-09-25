import { checkEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "نیاز به تنظیم" };

export default function SetupRequired() {
  const checks = checkEnv();
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-2xl font-black">اپ هنوز تنظیم نشده است</h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        متغیرهای محیطی زیر را در Vercel (Project → Settings → Environment Variables) اضافه کنید و سپس یک Redeploy بزنید. راهنمای کامل در فایل <code>docs/INSTALL_FA.md</code> مخزن است.
      </p>
      <ul className="mt-6 space-y-2">
        {checks.map((c) => (
          <li key={c.key} className="glass flex items-center gap-3 rounded-xl px-4 py-3 text-sm">
            <span className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "✔" : "✖"}</span>
            <span className="ltr font-mono text-xs">{c.key}</span>
            <span className="text-muted">— {c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
