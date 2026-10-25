import {
  siAnthropic,
  siDotnet,
  siGithubactions,
  siGooglegemini,
  siGsap,
  siJavascript,
  siN8n,
  siNextdotjs,
  siNodedotjs,
  siNumpy,
  siOpencv,
  siPostgresql,
  siPython,
  siPytorch,
  siReact,
  siSupabase,
  siTailwindcss,
  siTypescript,
  siVercel,
  siWebgl,
} from "simple-icons";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { SectionHead } from "@/components/home/section-head";

type Tool = { name: string; path?: string; mono?: string };

/** Hand-drawn stand-ins for tools without a public glyph (letters in a ring). */
const GROUPS: { title: { fa: string; en: string }; tools: Tool[] }[] = [
  {
    title: { fa: "هوش مصنوعی و مدل‌ها", en: "AI & models" },
    tools: [
      { name: "Gemini", path: siGooglegemini.path },
      { name: "Claude", path: siAnthropic.path },
      { name: "OpenAI-compatible", mono: "OA" },
      { name: "PyTorch", path: siPytorch.path },
      { name: "Segment Anything", mono: "SAM" },
      { name: "OpenCV", path: siOpencv.path },
    ],
  },
  {
    title: { fa: "ورکفلو و اتوماسیون", en: "Workflows & automation" },
    tools: [
      { name: "n8n", path: siN8n.path },
      { name: "ComfyUI", mono: "CU" },
      { name: "GitHub Actions", path: siGithubactions.path },
      { name: "Claude Code", mono: "CC" },
    ],
  },
  {
    title: { fa: "مهندسی نرم‌افزار و داده", en: "Software & data" },
    tools: [
      { name: "Python", path: siPython.path },
      { name: "TypeScript", path: siTypescript.path },
      { name: "JavaScript", path: siJavascript.path },
      { name: "SQL · PostgreSQL", path: siPostgresql.path },
      { name: "Next.js", path: siNextdotjs.path },
      { name: "React", path: siReact.path },
      { name: "Node.js", path: siNodedotjs.path },
      { name: "Supabase", path: siSupabase.path },
      { name: "Vercel", path: siVercel.path },
      { name: "NumPy", path: siNumpy.path },
      { name: ".NET · C#", path: siDotnet.path },
      { name: "SharePoint · EPM", mono: "SP" },
    ],
  },
  {
    title: { fa: "طراحی، موشن و مهندسی", en: "Design, motion & engineering" },
    tools: [
      { name: "Tailwind CSS", path: siTailwindcss.path },
      { name: "GSAP", path: siGsap.path },
      { name: "WebGL", path: siWebgl.path },
      { name: "SolidWorks", mono: "SW" },
      { name: "Brand systems", mono: "Aa" },
    ],
  },
];

export function Toolbox({ lang }: { lang: Lang }) {
  return (
    <section id="toolbox" className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-32">
      <SectionHead
        lang={lang}
        index="07"
        eyebrow={ui.sections.toolbox[lang]}
        title={lang === "fa" ? <>ابزار درست برای هر لایه</> : <>The right tool <span className="font-serif font-normal italic">for every layer</span></>}
      />
      <div className="mt-16 grid gap-px border border-line bg-line md:grid-cols-2">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="bg-bg p-6 md:p-8">
            <p className="mb-6 flex items-baseline gap-3 text-sm text-muted">
              <span className="font-mono text-[0.65rem] text-faint">{num(lang, `0${gi + 1}`)}</span>
              {g.title[lang]}
            </p>
            {/* lines drawn by the cells themselves, so the empty end of a short last row stays the page colour; every
                cell fills its whole grid area, so a row grown by a two-line name keeps its lines continuous */}
            <ul className="grid grid-cols-3 border-s border-t border-line sm:grid-cols-4" dir="ltr">
              {g.tools.map((t) => (
                <li key={t.name} data-fade className="group flex aspect-square flex-col items-center justify-center gap-3 self-stretch justify-self-stretch border-e border-b border-line bg-bg p-3 text-center transition-colors duration-500 hover:bg-fg hover:text-bg">
                  {t.path ? (
                    <svg viewBox="0 0 24 24" className="size-7 transition-transform duration-500 group-hover:scale-110" aria-hidden>
                      <path d={t.path} fill="currentColor" />
                    </svg>
                  ) : (
                    <span aria-hidden className="grid size-8 place-items-center rounded-full border border-current font-mono text-[0.6rem] font-semibold tracking-tight">{t.mono}</span>
                  )}
                  <span className="text-[0.68rem] leading-tight text-muted transition-colors group-hover:text-bg">{t.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
