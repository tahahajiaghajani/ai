"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang, L } from "@/lib/i18n";
import { num } from "@/lib/i18n";

/**
 * The audit centre, replayed on made-up codes (the dossier's own step-by-step example). On the server only the
 * case project and its tasks exist; "report" and "finding" are fields on that project, and the centre builds the
 * report → finding → case → action tree from them. A report or finding saved before its first case becomes ONE
 * placeholder project, hidden in the centre and recycled — completed and renamed — when the real case is saved.
 */

type SecState = "empty" | "filled" | "locked";
type Sec = { state: SecState; value?: string };
type Task = { code: string; pct: number; sub?: boolean };
type Proj = {
  id: string;
  report: string;
  finding: string;
  /** null = a placeholder ("no case") */
  case: string | null;
  tag?: string;
  tasks: Task[];
  mark?: "new" | "recycled" | "edited";
};
type Step = {
  act: L;
  /** which row button the user pressed (highlighted in the centre) */
  press?: { row: string; kind: "finding" | "case" | "action" };
  form: { report: Sec; finding: Sec; case: Sec; action: Sec; work?: Sec };
  projects: Proj[];
  log: string[];
  note: L;
};

const P1 = { id: "p1", report: "G-1", finding: "F-1" };

const STEPS: Step[] = [
  {
    act: { fa: "پرونده‌ی تازه: کاربر فقط گزارش G-1 و سرفصل F-1 را پر می‌کند و ذخیره را می‌زند", en: "New case file: only report G-1 and finding F-1 are filled in, then saved" },
    form: { report: { state: "filled", value: "G-1" }, finding: { state: "filled", value: "F-1" }, case: { state: "empty" }, action: { state: "empty" } },
    projects: [{ ...P1, case: null, tag: "X7K2Q", tasks: [], mark: "new" }],
    log: ["session   open · new project", "create    (no case) G-1 - F-1 — X7K2Q", "check-out", "write     report G-1 · finding F-1 · state no case", "publish", "check-in  (finally)"],
    note: {
      fa: "پیش از نخستین مصداق فقط یک رکورد نگه‌دارنده ساخته می‌شود، با نامی یکتا و گویا. در مرکز «گزارش G-1 ← سرفصل F-1» دیده می‌شود، بی هیچ مصداق نمایشی.",
      en: "Before the first case, exactly one placeholder record is created, with a unique, self-describing name. The centre shows «G-1 → F-1» with no visible case.",
    },
  },
  {
    act: { fa: "روی F-1 «+ مصداق»: گزارش و سرفصل پر و قفل‌اند؛ مصداق C-1 و اقدامش را پر می‌کند", en: "«+ case» on F-1: report and finding come filled and locked; case C-1 and its action are filled in" },
    press: { row: "F-1", kind: "case" },
    form: { report: { state: "locked", value: "G-1" }, finding: { state: "locked", value: "F-1" }, case: { state: "filled", value: "C-1" }, action: { state: "filled", value: "A1" } },
    projects: [{ ...P1, case: "C-1", tasks: [{ code: "A1", pct: 40 }], mark: "recycled" }],
    log: ["session   open · project p1", "reuse     the placeholder under F-1", "check-out", "write     case C-1 · rename", "add task  A1", "publish", "check-in  (finally)"],
    note: {
      fa: "سامانه نگه‌دارنده‌ی زیر F-1 را پیدا می‌کند، همان را تکمیل می‌کند و نامش را به C-1 تغییر می‌دهد؛ پروژه‌ی دوم ساخته نمی‌شود و ردی از نگه‌دارنده نمی‌ماند.",
      en: "The system finds the placeholder under F-1 and completes and renames it as C-1. No second project is created, and no trace of the placeholder remains.",
    },
  },
  {
    act: { fa: "دوباره «+ مصداق» روی F-1، این بار برای C-2", en: "«+ case» on F-1 again, this time for C-2" },
    press: { row: "F-1", kind: "case" },
    form: { report: { state: "locked", value: "G-1" }, finding: { state: "locked", value: "F-1" }, case: { state: "filled", value: "C-2" }, action: { state: "filled", value: "A1" } },
    projects: [
      { ...P1, case: "C-1", tasks: [{ code: "A1", pct: 40 }] },
      { id: "p2", report: "G-1", finding: "F-1", case: "C-2", tasks: [{ code: "A1", pct: 80 }], mark: "new" },
    ],
    log: ["session   open · new project", "no placeholder left under F-1", "create    C-2", "check-out", "write     G-1 · F-1 (copied) · case C-2", "add task  A1", "publish", "check-in  (finally)"],
    note: {
      fa: "نگه‌دارنده‌ای نمانده، پس پروژه‌ی تازه‌ای ساخته می‌شود و فیلدهای G-1 و F-1 خودکار رویش تکرار می‌شوند؛ چیزی دوباره تایپ نمی‌شود.",
      en: "No placeholder is left, so a new project is created with the G-1 and F-1 fields copied onto it automatically — nothing is retyped.",
    },
  },
  {
    act: { fa: "روی C-1 «+ اقدام»: اقدام دوم، A2", en: "«+ action» on C-1: a second action, A2" },
    press: { row: "C-1", kind: "action" },
    form: { report: { state: "locked", value: "G-1" }, finding: { state: "locked", value: "F-1" }, case: { state: "locked", value: "C-1" }, action: { state: "filled", value: "A2" } },
    projects: [
      { ...P1, case: "C-1", tasks: [{ code: "A1", pct: 40 }, { code: "A2", pct: 20 }], mark: "edited" },
      { id: "p2", report: "G-1", finding: "F-1", case: "C-2", tasks: [{ code: "A1", pct: 80 }] },
    ],
    log: ["session   open · project p1", "check-out", "add task  A2", "publish", "check-in  (finally)"],
    note: {
      fa: "اقدام‌ها فعالیت‌های همان پروژه‌ی مصداق‌اند، نه رکوردی جدا. سرفصل میانگین پیشرفت مصداق‌هایش را نشان می‌دهد؛ در گزارش حسابرسی داخلی، مصداق میانگین اقدام‌هایش است، و اگر همه وزن داشته باشند میانگین وزنی.",
      en: "Actions are tasks of the case project itself, not separate records. A finding shows the average progress of its cases; in the internal audit report a case is the average of its actions — weighted, if every action has a weight.",
    },
  },
  {
    act: { fa: "روی اقدام A1 «+ جزء کاری»: A1.1", en: "«+ work item» on action A1: A1.1" },
    form: { report: { state: "locked", value: "G-1" }, finding: { state: "locked", value: "F-1" }, case: { state: "locked", value: "C-1" }, action: { state: "locked", value: "A1" }, work: { state: "filled", value: "A1.1" } },
    projects: [
      { ...P1, case: "C-1", tasks: [{ code: "A1", pct: 40 }, { code: "A1.1", pct: 40, sub: true }, { code: "A2", pct: 20 }], mark: "edited" },
      { id: "p2", report: "G-1", finding: "F-1", case: "C-2", tasks: [{ code: "A1", pct: 80 }] },
    ],
    log: ["session   open · project p1", "check-out", "add task  A1.1 (sub-task of A1)", "publish", "check-in  (finally)"],
    note: {
      fa: "جزء کاری زیرفعالیت همان اقدام است. برای اقدامی که جزء کاری دارد، شروع، پایان و درصد تکمیل را خود Project Server حساب می‌کند.",
      en: "A work item is a sub-task of that action. For an action with work items, Project Server itself computes the start, finish and % complete.",
    },
  },
  {
    act: { fa: "روی G-1 «+ سرفصل یافته»: F-2، پیش از نخستین مصداقش", en: "«+ finding» on G-1: F-2, before its first case" },
    press: { row: "G-1", kind: "finding" },
    form: { report: { state: "locked", value: "G-1" }, finding: { state: "filled", value: "F-2" }, case: { state: "empty" }, action: { state: "empty" } },
    projects: [
      { ...P1, case: "C-1", tasks: [{ code: "A1", pct: 40 }, { code: "A1.1", pct: 40, sub: true }, { code: "A2", pct: 20 }] },
      { id: "p2", report: "G-1", finding: "F-1", case: "C-2", tasks: [{ code: "A1", pct: 80 }] },
      { id: "p3", report: "G-1", finding: "F-2", case: null, tag: "Q4M8T", tasks: [], mark: "new" },
    ],
    log: ["session   open · new project", "create    (no case) G-1 - F-2 — Q4M8T", "check-out", "write     report G-1 · finding F-2 · state no case", "publish", "check-in  (finally)"],
    note: {
      fa: "باز هم فقط یک نگه‌دارنده. «نام پنهان می‌شود، خود رکورد نه»: F-2 در مرکز دیده می‌شود، ولی نگه‌دارنده‌اش در شمار مصداق‌ها نمی‌آید، وگرنه آمار مرکز دروغ می‌شد.",
      en: "Again exactly one placeholder. «The name is hidden, not the record»: F-2 appears in the centre, but its placeholder is left out of the case counts — otherwise the centre's statistics would lie.",
    },
  },
];

const SECTIONS = [
  { key: "report", fa: "شناسنامه‌ی گزارش", en: "Report identity" },
  { key: "finding", fa: "شناسنامه‌ی سرفصل یافته", en: "Finding identity" },
  { key: "case", fa: "شناسنامه‌ی مصداق", en: "Case identity" },
  { key: "action", fa: "اقدام (توصیه و پیگیری)", en: "Action (recommendation & follow-up)" },
  { key: "work", fa: "جزء کاری", en: "Work item" },
] as const;

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
/** a case's progress: the average of its actions (top-level tasks); none → no progress */
const casePct = (p: Proj) => avg(p.tasks.filter((t) => !t.sub).map((t) => t.pct));

/** the centre: reports → findings → real cases; placeholders keep their report/finding rows but are not cases */
function centre(projects: Proj[]) {
  const reports: { code: string; findings: { code: string; cases: Proj[] }[] }[] = [];
  for (const p of projects) {
    let r = reports.find((x) => x.code === p.report);
    if (!r) reports.push((r = { code: p.report, findings: [] }));
    let f = r.findings.find((x) => x.code === p.finding);
    if (!f) r.findings.push((f = { code: p.finding, cases: [] }));
    if (p.case) f.cases.push(p);
  }
  return reports;
}

const placeholderName = (p: Proj, lang: Lang) => `${lang === "fa" ? "(بدون مصداق)" : "(no case)"} ${p.report} - ${p.finding} — ${p.tag}`;

function Lock() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor" />
      <path d="M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function AuditCentre({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const step = STEPS[i];

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  /** auto = the first play when the piece scrolls into view; reduced motion skips only that one */
  const play = useCallback((auto = false) => {
    stop();
    setI(0);
    if (auto && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPlaying(true);
    const next = (k: number) => {
      timer.current = setTimeout(() => {
        setI(k);
        if (k < STEPS.length - 1) next(k + 1);
        else setPlaying(false);
      }, 3400);
    };
    next(1);
  }, [stop]);

  // play once when the piece reaches the reader, unless they already picked a step
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        if (!touched.current) play(true);
      },
      { threshold: 0, rootMargin: "0px 0px -35% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [play]);

  const tree = centre(step.projects);
  const realCases = step.projects.filter((p) => p.case).length;
  const holders = step.projects.length - realCases;
  const pct = (v: number | null) => (v == null ? "—" : fa ? `${num(lang, v)}٪` : `${v}%`);
  const code = (s: string) => (
    <bdi className="font-mono text-[0.95em]" dir="ltr">
      {s}
    </bdi>
  );
  const pressed = (row: string, kind: "finding" | "case" | "action") => step.press?.row === row && step.press.kind === kind;
  const plus = (row: string, kind: "finding" | "case" | "action") => (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.66rem] transition-colors duration-500 ${pressed(row, kind) ? "border-fg bg-fg text-bg" : "border-line text-faint"}`}
    >
      + {kind === "finding" ? (fa ? "سرفصل یافته" : "finding") : kind === "case" ? (fa ? "مصداق" : "case") : fa ? "اقدام" : "action"}
    </span>
  );
  const markTag = (m?: Proj["mark"]) =>
    m ? (
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-fg" dir="ltr">
        {m === "new" ? "new" : m === "recycled" ? "recycled" : "edited"}
      </span>
    ) : null;

  return (
    <div ref={root} className="overflow-hidden rounded-[6px] border border-line bg-line">
      {/* steps */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-2 px-4 py-3 md:px-6">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint" dir="ltr">
          audit centre · step {i + 1}/{STEPS.length}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-line" role="group" aria-label={fa ? "گام‌ها" : "Steps"}>
            {STEPS.map((_, k) => (
              <button
                key={k}
                type="button"
                aria-pressed={i === k}
                aria-label={fa ? `گام ${num(lang, k + 1)}` : `Step ${k + 1}`}
                onClick={() => {
                  touched.current = true;
                  stop();
                  setI(k);
                }}
                className={`min-w-9 px-2.5 py-1.5 text-[0.72rem] transition-colors ${i === k ? "bg-fg text-bg" : k < i ? "text-fg-2 hover:text-fg" : "text-muted hover:text-fg"}`}
              >
                {num(lang, k + 1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              touched.current = true;
              play();
            }}
            className="rounded-full border border-line px-3 py-1.5 text-[0.72rem] transition-colors hover:border-fg"
          >
            {playing ? (fa ? "از نو" : "Restart") : fa ? "پخش" : "Play"}
          </button>
        </div>
      </div>

      {/* what the user does */}
      <div className="bg-bg px-4 py-4 md:px-6" aria-live="polite">
        <p key={i} className="text-[0.95rem] leading-relaxed text-fg motion-safe:animate-[fade-in_0.5s_ease-out]">
          <span className="me-2 font-mono text-[0.7rem] text-faint">{num(lang, String(i + 1).padStart(2, "0"))}</span>
          {step.act[lang]}
        </p>
      </div>

      <div className="grid gap-px lg:grid-cols-3">
        {/* the form */}
        <div className="min-w-0 bg-bg-2 p-4 md:p-6">
          <p className="mb-4 text-[0.75rem] text-muted">{fa ? "فرم پرونده: چهار بخش، روی یک پروژه" : "The case form: four sections, one project"}</p>
          <ol className="grid gap-2">
            {SECTIONS.map((s) => {
              const sec = step.form[s.key];
              // the work-item row only appears when a work item is being added
              if (!sec) return null;
              return (
                <li
                  key={s.key}
                  className={`flex items-center justify-between gap-3 rounded-[4px] border px-3 py-2.5 transition-colors duration-500 ${
                    sec.state === "empty" ? "border-dashed border-line text-faint" : sec.state === "locked" ? "border-line bg-bg text-fg-2" : "border-fg bg-bg text-fg"
                  }`}
                >
                  <span className="min-w-0 truncate text-[0.8rem]">{s[lang]}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[0.72rem]">
                    {sec.value ? code(sec.value) : null}
                    {sec.state === "locked" ? (
                      <span className="flex items-center gap-1 text-muted">
                        <Lock />
                        {fa ? "پیش‌پر" : "prefilled"}
                      </span>
                    ) : sec.state === "empty" ? (
                      <span>{fa ? "خالی" : "empty"}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* what really exists on the server */}
        <div className="min-w-0 bg-bg-2 p-4 md:p-6">
          <p className="mb-4 flex items-baseline justify-between gap-3 text-[0.75rem] text-muted">
            <span>{fa ? "روی Project Server: آنچه واقعاً ثبت می‌شود" : "On Project Server: what is really stored"}</span>
            <span className="shrink-0 font-mono">
              {num(lang, step.projects.length)} {fa ? "پروژه" : step.projects.length === 1 ? "project" : "projects"}
            </span>
          </p>
          <ul className="grid gap-2">
            {step.projects.map((p) => (
              <li
                key={p.id}
                className={`rounded-[4px] border bg-bg px-3 py-2.5 transition-[border-color,box-shadow] duration-700 ${p.case ? "border-line" : "border-dashed border-fg-2"} ${p.mark ? "shadow-[0_0_0_1px_var(--fg)]" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[0.82rem]" dir="auto">
                    {p.case ? code(p.case) : <span className="text-muted">{placeholderName(p, lang)}</span>}
                  </span>
                  {markTag(p.mark)}
                </div>
                <p className="mt-1 font-mono text-[0.66rem] text-faint" dir="ltr">
                  report={p.report} · finding={p.finding} · state={p.case ? "complete" : "no case"}
                </p>
                {p.tasks.length ? (
                  <p className="mt-1.5 flex flex-wrap gap-1.5" dir="ltr">
                    {p.tasks.map((t) => (
                      <span key={t.code} className={`rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[0.62rem] ${t.sub ? "text-faint" : "text-fg-2"}`}>
                        {t.sub ? "└ " : ""}
                        {t.code} {t.pct}%
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {/* what users see */}
        <div className="min-w-0 bg-bg-2 p-4 md:p-6">
          <p className="mb-4 flex items-baseline justify-between gap-3 text-[0.75rem] text-muted">
            <span>{fa ? "در مرکز حسابرسی: آنچه کاربر می‌بیند" : "In the audit centre: what users see"}</span>
            <span className="shrink-0 font-mono">
              {num(lang, realCases)} {fa ? "مصداق" : realCases === 1 ? "case" : "cases"}
            </span>
          </p>
          <ul className="grid gap-1.5 text-[0.82rem]">
            {tree.map((r) => {
              const all = r.findings.flatMap((f) => f.cases);
              return (
                <li key={r.code} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2 rounded-[4px] bg-bg px-3 py-2">
                    <span className="min-w-0 truncate">
                      {fa ? "گزارش" : "Report"} {code(r.code)}
                      <span className="ms-2 text-[0.7rem] text-muted">
                        {num(lang, r.findings.length)} {fa ? "سرفصل" : r.findings.length === 1 ? "finding" : "findings"} · {num(lang, all.length)} {fa ? "مصداق" : all.length === 1 ? "case" : "cases"}
                      </span>
                    </span>
                    {plus(r.code, "finding")}
                  </div>
                  <ul className="grid gap-1.5 ps-4">
                    {r.findings.map((f) => (
                      <li key={f.code} className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-2 rounded-[4px] bg-bg px-3 py-2">
                          <span className="min-w-0 truncate">
                            {fa ? "سرفصل" : "Finding"} {code(f.code)}
                            <span className="ms-2 text-[0.7rem] text-muted">
                              {num(lang, f.cases.length)} {fa ? "مصداق" : f.cases.length === 1 ? "case" : "cases"} · {pct(avg(f.cases.map(casePct).filter((v): v is number => v != null)))}
                            </span>
                          </span>
                          {plus(f.code, "case")}
                        </div>
                        {f.cases.length ? (
                          <ul className="grid gap-1.5 ps-4">
                            {f.cases.map((c) => (
                              <li key={c.id} className="flex items-center justify-between gap-2 rounded-[4px] border border-line px-3 py-2">
                                <span className="min-w-0 truncate">
                                  {fa ? "مصداق" : "Case"} {code(c.case!)}
                                  <span className="ms-2 text-[0.7rem] text-muted">
                                    {num(lang, c.tasks.filter((t) => !t.sub).length)} {fa ? "اقدام" : c.tasks.filter((t) => !t.sub).length === 1 ? "action" : "actions"} · {pct(casePct(c))}
                                  </span>
                                </span>
                                {plus(c.case!, "action")}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* the write session and what it means */}
      <div className="grid gap-px lg:grid-cols-[1fr_1fr]">
        <pre className="code min-h-[11.5rem] overflow-x-auto bg-bg p-4 text-[0.72rem] leading-[1.75] md:p-6 [scrollbar-width:thin]" dir="ltr" data-lenis-prevent-wheel>
          {step.log.map((l, k) => (
            <span key={`${i}-${k}`} className={k === step.log.length - 1 ? "text-fg" : "text-fg-2"}>
              {l}
              {"\n"}
            </span>
          ))}
        </pre>
        <div className="flex flex-col justify-between gap-5 bg-bg p-4 md:p-6">
          <p key={i} className="text-[0.88rem] leading-relaxed text-fg-2 motion-safe:animate-[fade-in_0.5s_ease-out]">
            {step.note[lang]}
          </p>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[4px] border border-line bg-line text-center">
            {[
              { k: fa ? "پروژه روی سرور" : "projects stored", v: step.projects.length },
              { k: fa ? "نگه‌دارنده" : "placeholders", v: holders },
              { k: fa ? "مصداق در مرکز" : "cases shown", v: realCases },
            ].map((s) => (
              <div key={s.k} className="flex flex-col-reverse bg-bg-2 px-2 py-3">
                <dt className="mt-1 text-[0.68rem] text-muted">{s.k}</dt>
                <dd className="latin text-2xl font-semibold tracking-[-0.04em]">{num(lang, s.v)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[0.75rem] leading-relaxed text-faint">
            {fa
              ? "در PWA قدیمی هر مصداق خودش پروژه‌ی ریشه بود و به گزارش یا سرفصلی که ثبت شده بود نمی‌شد چیزی افزود. رفتار هر گام همان است که در کد آمده؛ کدهای گزارش، سرفصل و مصداق ساختگی‌اند."
              : "In the old PWA every case was its own root project, and nothing could be added to a report or finding already registered. Each step behaves as the code does; the report, finding and case codes are made up."}
          </p>
        </div>
      </div>
    </div>
  );
}
