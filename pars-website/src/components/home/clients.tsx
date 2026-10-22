import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { KEY_CLIENTS, engagements } from "@/content/clients";
import { num, type Lang } from "@/lib/i18n";

/** Key clients from the company profile: official logo, sector and what Pars did there (software, consulting, training). */
export function Clients({ lang, t }: { lang: Lang; t: Copy }) {
  const r = t.records;
  const sep = lang === "fa" ? "، " : ", ";
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {KEY_CLIENTS.map((c, i) => {
        const e = engagements(c);
        const training = e.training.map((x) => (x.count ? `${x.label[lang]} (${num(x.count, lang)} ${x.count === 1 ? r.course : r.courses})` : x.label[lang])).join(sep);
        const rows = [
          { label: r.software, items: e.software.map((x) => x[lang]) },
          { label: r.consulting, items: e.consulting.map((x) => x[lang]) },
          { label: r.training, items: training ? [training] : [] },
        ].filter((row) => row.items.length);
        return (
          <li key={c.key} data-reveal style={{ "--d": i % 3 } as CSSProperties} className="card group flex flex-col overflow-hidden transition duration-500 hover:-translate-y-1 hover:border-line-strong">
            {/* bank logos are drawn for light paper, so they sit on a light plate in their own colors */}
            <div className="relative grid h-32 place-items-center overflow-hidden bg-mist px-8 sm:h-36">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,rgb(143_134_255/0.10),transparent_60%)] opacity-0 transition duration-500 group-hover:opacity-100" />
              {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logos */}
              <img src={c.logo} alt={c.name[lang]} loading="lazy" decoding="async" className="relative max-h-[72px] w-auto max-w-[78%] object-contain transition duration-500 group-hover:scale-[1.04]" />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-[15px] font-semibold leading-7 text-fg">{c.name[lang]}</h4>
                <span className="text-xs text-faint">{c.sector[lang]}</span>
              </div>
              <dl className="mt-4 space-y-3 text-sm leading-6">
                {rows.map((row) => (
                  <div key={row.label}>
                    <dt className="text-[11px] font-semibold text-violet">{row.label}</dt>
                    {row.items.map((it) => (
                      <dd key={it} className="mt-1 text-muted">
                        {it}
                      </dd>
                    ))}
                  </div>
                ))}
              </dl>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
