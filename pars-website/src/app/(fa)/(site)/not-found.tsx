import { copy, href } from "@/lib/i18n";

export default function NotFound() {
  const t = copy("fa");
  return (
    <section className="grid min-h-[80svh] place-items-center px-6 pt-[var(--header-h)] text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pars-mark-reverse.svg" alt="" className="mx-auto h-16 w-auto animate-float" />
        <p className="mt-6 font-brand text-6xl font-bold text-gradient">404</p>
        <p className="mt-4 text-lg text-muted">{t.ticket.notFound}</p>
        <a href={href("fa", "/")} className="mt-8 inline-flex h-12 items-center rounded-full bg-magenta px-6 font-semibold text-white">
          {t.meta.short}
        </a>
      </div>
    </section>
  );
}
