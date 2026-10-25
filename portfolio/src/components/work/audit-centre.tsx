"use client";

import { useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";

/**
 * The audit-centre idea, as a toy organisation: open an audit file on any level. In a project-only system
 * (the old PWA) a file above project level needs a placeholder project for that level and for every level
 * between it and the projects; in the new system the file is built on the level itself and covers what lies
 * beneath it.
 */

type Node = { id: string; level: 0 | 1 | 2 | 3; parent: string | null; x: number };

const LEVELS = [
  { fa: "سازمان", en: "Organisation" },
  { fa: "مدیریت", en: "Directorate" },
  { fa: "اداره", en: "Office" },
  { fa: "پروژه", en: "Project" },
];

// a small, generic tree: 1 organisation → 2 directorates → 4 offices → 10 projects
const NODES: Node[] = (() => {
  const out: Node[] = [{ id: "o", level: 0, parent: null, x: 0.5 }];
  const dirs = ["d1", "d2"];
  const offices: Record<string, string[]> = { d1: ["f1", "f2"], d2: ["f3", "f4"] };
  const projects: Record<string, number> = { f1: 3, f2: 2, f3: 3, f4: 2 };
  dirs.forEach((d, i) => out.push({ id: d, level: 1, parent: "o", x: 0.27 + i * 0.46 }));
  let p = 0;
  const total = Object.values(projects).reduce((a, b) => a + b, 0);
  dirs.forEach((d) =>
    offices[d].forEach((f) => {
      const n = projects[f];
      const first = p;
      for (let k = 0; k < n; k++, p++) out.push({ id: `p${p}`, level: 3, parent: f, x: 0.05 + (p / (total - 1)) * 0.9 });
      out.push({ id: f, level: 2, parent: d, x: 0.05 + (((first + p - 1) / 2) / (total - 1)) * 0.9 });
    }),
  );
  return out;
})();

const byId = new Map(NODES.map((n) => [n.id, n]));
const children = (id: string) => NODES.filter((n) => n.parent === id);
const descendants = (id: string): Node[] => children(id).flatMap((c) => [c, ...descendants(c.id)]);

const W = 1000;
const H = 400;
const Y = [50, 150, 250, 350];

export function AuditCentre({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  const [mode, setMode] = useState<"pwa" | "new">("new");
  const [open, setOpen] = useState<string>("d1");

  const target = byId.get(open)!;
  const scope = useMemo(() => new Set([open, ...descendants(open).map((n) => n.id)]), [open]);
  const covered = mode === "new" ? descendants(open).filter((n) => n.level === 3).length + (target.level === 3 ? 1 : 0) : 0;
  // a project-only system: the file is itself a project, and every level between it and the projects needs one too
  const placeholders = mode === "pwa" && target.level < 3 ? [target, ...descendants(open).filter((n) => n.level < 3)] : [];
  const lit = (id: string) => (mode === "new" ? scope.has(id) : id === open);

  const label = (n: Node) => {
    const i = n.level === 0 ? 0 : NODES.filter((m) => m.level === n.level).findIndex((m) => m.id === n.id) + 1;
    return n.level === 0 ? LEVELS[0][lang] : `${LEVELS[n.level][lang]} ${num(lang, i)}`;
  };

  return (
    <div className="overflow-hidden rounded-[6px] border border-line bg-line">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-2 px-4 py-3 md:px-6">
        <p className="text-[0.8rem] text-muted">{fa ? "روی هر سطح بزنید تا پرونده‌ی حسابرسی آن باز شود" : "Tap any level to open its audit file"}</p>
        <div className="flex overflow-hidden rounded-full border border-line text-[0.72rem]" role="group" aria-label={fa ? "سامانه" : "System"}>
          {(["pwa", "new"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`px-3.5 py-1.5 transition-colors ${mode === m ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}>
              {m === "pwa" ? (fa ? "PWA قدیمی" : "Old PWA") : fa ? "سامانه‌ی جدید" : "New system"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-px lg:grid-cols-[1.6fr_1fr]">
        <div className="overflow-x-auto bg-bg-2 p-4 md:p-6 [scrollbar-width:thin]" dir="ltr" data-lenis-prevent-wheel>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[620px] text-fg" role="img" aria-label={fa ? "سلسله‌مراتب سازمان و دامنه‌ی پرونده‌ی حسابرسی" : "Organisation hierarchy and the audit file's scope"}>
            {/* level rails */}
            {LEVELS.map((l, i) => (
              <g key={i}>
                <line x1={0} x2={W} y1={Y[i]} y2={Y[i]} stroke="currentColor" strokeOpacity={0.06} />
                <text x={6} y={Y[i] - 26} className="fill-current font-mono text-[10px] uppercase tracking-[0.14em]" opacity={0.4}>
                  {LEVELS[i].en}
                </text>
              </g>
            ))}
            {/* tree edges */}
            {NODES.filter((n) => n.parent).map((n) => {
              const p = byId.get(n.parent!)!;
              const on = mode === "new" && scope.has(n.id) && scope.has(p.id);
              return <line key={`e-${n.id}`} x1={p.x * W} y1={Y[p.level] + 16} x2={n.x * W} y2={Y[n.level] - 16} stroke="currentColor" strokeOpacity={on ? 0.75 : 0.18} strokeWidth={on ? 1.5 : 1} className="transition-all duration-500" />;
            })}
            {/* placeholder projects the old system needs, drawn beside each level */}
            {placeholders.map((n) => (
              <g key={`ph-${n.id}`} transform={`translate(${n.x * W + 24} ${Y[n.level] - 30})`}>
                <rect width={34} height={20} rx={3} fill="var(--bg)" stroke="currentColor" strokeDasharray="3 3" />
                <text x={17} y={14} textAnchor="middle" className="fill-current font-mono text-[10px]">+P</text>
              </g>
            ))}
            {/* nodes */}
            {NODES.map((n) => {
              const inScope = lit(n.id);
              const isOpen = n.id === open;
              const r = n.level === 3 ? 11 : 16;
              return (
                <g key={n.id} transform={`translate(${n.x * W} ${Y[n.level]})`} onClick={() => setOpen(n.id)} className="cursor-pointer">
                  <title>{label(n)}</title>
                  {n.level === 3 ? (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill={inScope ? "currentColor" : "var(--bg)"} stroke="currentColor" strokeOpacity={inScope ? 1 : 0.4} className="transition-colors duration-500" />
                  ) : (
                    <circle r={r} fill={inScope ? "currentColor" : "var(--bg)"} stroke="currentColor" strokeOpacity={inScope ? 1 : 0.4} className="transition-colors duration-500" />
                  )}
                  {isOpen ? <circle r={r + 9} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="5 5" className="glyph-spin" style={{ transformBox: "fill-box" }} /> : null}
                </g>
              );
            })}
          </svg>
          {/* a keyboard path to every level: the same choice as tapping the drawing */}
          <div className="mt-3 flex flex-wrap gap-1.5" dir={fa ? "rtl" : "ltr"}>
            {NODES.filter((n) => n.level < 3).map((n) => (
              <button key={n.id} type="button" onClick={() => setOpen(n.id)} aria-pressed={open === n.id} className={`rounded-full border px-3 py-1 text-[0.72rem] transition-colors ${open === n.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg"}`}>
                {label(n)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-5 bg-bg-2 p-4 md:p-6">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line">
            <div className="bg-bg p-4">
              <dt className="text-[0.75rem] text-muted">{fa ? "پروژه‌های ساختگی لازم" : "Placeholder projects needed"}</dt>
              <dd className="latin mt-2 text-4xl font-semibold tracking-[-0.04em]">{num(lang, placeholders.length)}</dd>
            </div>
            <div className="bg-bg p-4">
              <dt className="text-[0.75rem] text-muted">{fa ? "پروژه‌هایی که خودکار پوشش می‌دهد" : "Projects it covers by itself"}</dt>
              <dd className="latin mt-2 text-4xl font-semibold tracking-[-0.04em]">{num(lang, covered)}</dd>
            </div>
          </dl>
          <pre className="code overflow-hidden rounded-[4px] border border-line bg-bg p-4 text-[0.72rem] leading-[1.75]" dir="ltr" aria-live="polite">
            <span className="t-p">{"{"}</span>
            {"\n  "}<span className="t-s">&quot;file&quot;</span>: <span className="t-s">&quot;audit&quot;</span>,
            {"\n  "}<span className="t-s">&quot;attached_to&quot;</span>: <span className="t-k">{mode === "pwa" && target.level < 3 ? "\"placeholder project\"" : `"${LEVELS[target.level].en.toLowerCase()}"`}</span>,
            {"\n  "}<span className="t-s">&quot;covers&quot;</span>: <span className="t-n">{mode === "new" ? descendants(open).length : 0}</span><span className="t-c">{mode === "new" ? " // levels and projects beneath it" : " // gathered by hand"}</span>,
            {"\n  "}<span className="t-s">&quot;extra_projects&quot;</span>: <span className="t-n">{placeholders.length}</span>
            {"\n"}<span className="t-p">{"}"}</span>
          </pre>
          <p className="text-[0.8rem] leading-relaxed text-muted">
            {fa
              ? "در سامانه‌ای که همه‌چیز در آن پروژه است، پرونده‌ای بالاتر از پروژه یعنی ثبت پروژه‌ی ساختگی (+P) برای همان سطح و هر سطح میان آن و پروژه‌ها، و جمع کردن دستی بقیه. در سامانه‌ی جدید پرونده روی خود سطح سازمانی ساخته می‌شود و آنچه زیر آن است را دربر می‌گیرد. این یک نمایش نمادین از ایده است؛ سازمان و عددها واقعی نیستند."
              : "In a system where everything is a project, a file above project level means registering a placeholder project (+P) for that level and every level between it and the projects, and gathering the rest by hand. In the new system the file is built on the organisational level itself and covers what lies beneath it. This is an illustration of the idea; the organisation and numbers are not real."}
          </p>
        </div>
      </div>
    </div>
  );
}
