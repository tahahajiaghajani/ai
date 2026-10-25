"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";

/**
 * A replay of Task Flow's workflow engine on a pre-work graph with a reviewer (yes/no router).
 * `schedule()` below is the same pure rule the real engine runs: a node is ready when all its inputs are
 * resolved and at least one is active; a node whose inputs are all resolved but none active is skipped,
 * and skipping cascades. Each tick runs up to three ready nodes in parallel, like one worker invocation.
 */

type Kind = "llm" | "router" | "coder" | "human";
type Status = "pending" | "running" | "done" | "skipped";
type Decision = "yes" | "no";

const NODES: { id: string; kind: Kind; x: number; y: number; label: { fa: string; en: string }; sub: string }[] = [
  { id: "analyze", kind: "llm", x: 0, y: 1, label: { fa: "تحلیل‌گر", en: "Analyzer" }, sub: "gemini-flash" },
  { id: "brief", kind: "llm", x: 1, y: 1, label: { fa: "دستور کار", en: "Work order" }, sub: "BRIEF.md" },
  { id: "helpers", kind: "llm", x: 2, y: 0, label: { fa: "فایل‌های کمکی", en: "Helper files" }, sub: "claude" },
  { id: "summary", kind: "llm", x: 2, y: 2, label: { fa: "گزارش کوتاه", en: "Short report" }, sub: "reply" },
  { id: "reviewer", kind: "router", x: 3, y: 1, label: { fa: "بازبین", en: "Reviewer" }, sub: "router" },
  { id: "coder", kind: "coder", x: 4, y: 0, label: { fa: "مجری", en: "Executor" }, sub: "claude-code" },
  { id: "revise", kind: "human", x: 4, y: 2, label: { fa: "درخواست اصلاح", en: "Ask for a fix" }, sub: "human" },
];

const EDGES: { source: string; target: string; when?: Decision }[] = [
  { source: "analyze", target: "brief" },
  { source: "brief", target: "helpers" },
  { source: "brief", target: "summary" },
  { source: "helpers", target: "reviewer" },
  { source: "summary", target: "reviewer" },
  { source: "reviewer", target: "coder", when: "yes" },
  { source: "reviewer", target: "revise", when: "no" },
];

type Outcomes = Record<string, { status: Status; decision?: Decision }>;

const incoming = (id: string) => EDGES.filter((e) => e.target === id);

function schedule(outcomes: Outcomes) {
  const status = (id: string): Status => outcomes[id]?.status ?? "pending";
  const skipped = new Set<string>();
  const effective = (id: string): Status => (skipped.has(id) ? "skipped" : status(id));
  const active = (e: (typeof EDGES)[number]) => effective(e.source) === "done" && (!e.when || outcomes[e.source]?.decision === e.when);
  const resolved = (e: (typeof EDGES)[number]) => ["done", "skipped"].includes(effective(e.source));
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of NODES) {
      if (effective(n.id) !== "pending") continue;
      const inc = incoming(n.id);
      if (inc.length && inc.every(resolved) && !inc.some(active)) {
        skipped.add(n.id);
        changed = true;
      }
    }
  }
  const ready = NODES.filter((n) => effective(n.id) === "pending")
    .filter((n) => {
      const inc = incoming(n.id);
      return !inc.length || (inc.every(resolved) && inc.some(active));
    })
    .map((n) => n.id);
  return { ready, skip: [...skipped] };
}

const W = 1000;
const H = 330;
const NW = 156;
const NH = 62;
const pos = (n: (typeof NODES)[number]) => ({ x: 20 + n.x * 202, y: 22 + n.y * 112 });

const KIND_TAG: Record<Kind, string> = { llm: "llm", router: "router", coder: "coder", human: "human" };

export function DagPlayer({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  const [decision, setDecision] = useState<Decision>("yes");
  const [outcomes, setOutcomes] = useState<Outcomes>({});
  const [log, setLog] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useRef({ outcomes: {} as Outcomes, tick: 0, decision: "yes" as Decision });

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  /** one engine step: finish what is running, or schedule and start the next ready nodes */
  const step = useCallback((): boolean => {
    const s = state.current;
    const o = { ...s.outcomes };
    const running = Object.keys(o).filter((k) => o[k].status === "running");
    const t = String(s.tick + 1).padStart(2, "0");
    let line: string;
    if (running.length) {
      for (const id of running) o[id] = id === "reviewer" ? { status: "done", decision: s.decision } : { status: "done" };
      line = `tick ${t}  done    ${running.join(", ")}${running.includes("reviewer") ? `  → decision: ${s.decision}` : ""}`;
    } else {
      const { ready, skip } = schedule(o);
      for (const id of skip) o[id] = { status: "skipped" };
      const run = ready.slice(0, 3);
      for (const id of run) o[id] = { status: "running" };
      if (!run.length && !skip.length) {
        setLog((l) => [...l, `tick ${t}  workflow complete ✓`]);
        return false;
      }
      line = `tick ${t}  ${run.length ? `run     ${run.join(" ‖ ")}  (${run.length}/3)` : ""}${skip.length ? `${run.length ? "\n         " : ""}skip    ${skip.join(", ")}` : ""}`;
    }
    s.outcomes = o;
    s.tick += 1;
    setOutcomes(o);
    setTick(s.tick);
    setLog((l) => [...l, line]);
    return true;
  }, []);

  const play = useCallback(
    (d: Decision) => {
      stop();
      state.current = { outcomes: {}, tick: 0, decision: d };
      setOutcomes({});
      setTick(0);
      setLog([`engine  prework · decision=${d}`]);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        while (step()) {}
        return;
      }
      setPlaying(true);
      const loop = () => {
        timer.current = setTimeout(() => {
          if (step()) loop();
          else setPlaying(false);
        }, 1050);
      };
      loop();
    },
    [step, stop],
  );

  // start once when the player scrolls into view
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        play("yes");
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [play]);

  const st = (id: string): Status => outcomes[id]?.status ?? "pending";
  const edgeOn = (e: (typeof EDGES)[number]) => st(e.source) === "done" && (!e.when || outcomes[e.source]?.decision === e.when);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div ref={root} className="overflow-hidden rounded-[6px] border border-line bg-line">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-2 px-4 py-3 md:px-6">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint" dir="ltr">
          workflow · prework-review · tick {String(tick).padStart(2, "0")}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[0.75rem] text-muted">{fa ? "رأی بازبین" : "Reviewer says"}</span>
          <div className="flex overflow-hidden rounded-full border border-line font-mono text-[0.64rem] uppercase tracking-[0.12em]" dir="ltr">
            {(["yes", "no"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={decision === d}
                onClick={() => {
                  setDecision(d);
                  play(d);
                }}
                className={`px-3 py-1.5 transition-colors ${decision === d ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => play(decision)}
            className="rounded-full border border-line px-3 py-1.5 text-[0.72rem] transition-colors hover:border-fg"
          >
            {playing ? (fa ? "از نو" : "Restart") : fa ? "پخش دوباره" : "Replay"}
          </button>
        </div>
      </div>

      <div className="grid gap-px lg:grid-cols-[1.6fr_1fr]">
        <div className="overflow-x-auto bg-bg-2 p-4 md:p-6 [scrollbar-width:thin]" dir="ltr" data-lenis-prevent-wheel>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[640px] text-fg" role="img" aria-label={fa ? "اجرای گام‌به‌گام یک ورکفلوی DAG" : "Step-by-step run of a DAG workflow"}>
            <defs>
              <marker id="dp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
              </marker>
            </defs>
            {EDGES.map((e) => {
              const a = pos(NODES.find((n) => n.id === e.source)!);
              const b = pos(NODES.find((n) => n.id === e.target)!);
              const x1 = a.x + NW;
              const y1 = a.y + NH / 2;
              const x2 = b.x;
              const y2 = b.y + NH / 2;
              const dx = (x2 - x1) * 0.5;
              const d = `M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const on = edgeOn(e);
              const dead = st(e.target) === "skipped";
              return (
                <g key={`${e.source}-${e.target}`} opacity={dead ? 0.25 : 1} className="transition-opacity duration-500">
                  <path d={d} fill="none" stroke="currentColor" strokeOpacity={on ? 0.9 : 0.25} strokeWidth={on ? 1.6 : 1.1} strokeDasharray={dead ? "3 5" : undefined} markerEnd="url(#dp-arrow)" className="transition-all duration-500" />
                  {on && st(e.target) === "running" ? <path d={d} fill="none" stroke="currentColor" strokeWidth={2.6} strokeDasharray="6 120" className="glyph-flow" /> : null}
                  {e.when ? (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="fill-current font-mono text-[11px]" opacity={on ? 1 : 0.45}>
                      {e.when}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {NODES.map((n) => {
              const p = pos(n);
              const s = st(n.id);
              const done = s === "done";
              return (
                <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={s === "skipped" ? 0.3 : 1} className="transition-opacity duration-500">
                  {n.kind === "router" ? (
                    <path d={`M${NW / 2} -6 L${NW + 6} ${NH / 2} L${NW / 2} ${NH + 6} L-6 ${NH / 2} Z`} fill={done ? "currentColor" : "var(--bg)"} stroke="currentColor" strokeOpacity={s === "pending" ? 0.35 : 1} strokeDasharray={s === "skipped" ? "4 4" : undefined} className="transition-colors duration-500" />
                  ) : (
                    <rect width={NW} height={NH} rx={n.kind === "human" ? NH / 2 : 6} fill={done ? "currentColor" : "var(--bg)"} stroke="currentColor" strokeOpacity={s === "pending" ? 0.35 : 1} strokeDasharray={s === "skipped" ? "4 4" : undefined} className="transition-colors duration-500" />
                  )}
                  {s === "running" ? (
                    <rect x={-5} y={-5} width={NW + 10} height={NH + 10} rx={n.kind === "human" ? NH / 2 + 5 : 9} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="6 6" className="glyph-flow" />
                  ) : null}
                  <text x={NW / 2} y={NH / 2 - 4} textAnchor="middle" className={`text-[15px] font-semibold ${done ? "fill-[var(--bg)]" : "fill-current"}`} style={{ fontFamily: fa ? "var(--font-fa)" : undefined }}>
                    {n.label[lang]}
                  </text>
                  <text x={NW / 2} y={NH / 2 + 15} textAnchor="middle" className={`font-mono text-[10px] ${done ? "fill-[var(--bg)]" : "fill-current"}`} opacity={0.6}>
                    {s === "skipped" ? "skipped" : s === "running" ? "running…" : n.sub}
                  </text>
                  <text x={n.kind === "router" ? NW / 2 : 0} y={n.kind === "router" ? -14 : -8} textAnchor={n.kind === "router" ? "middle" : "start"} className="fill-current font-mono text-[9px] uppercase tracking-[0.14em]" opacity={0.4}>
                    {KIND_TAG[n.kind]}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex flex-col gap-4 bg-bg-2 p-4 md:p-6">
          <pre ref={logRef} className="code h-[230px] overflow-y-auto rounded-[4px] border border-line bg-bg p-4 text-[0.72rem] leading-[1.75] [scrollbar-width:thin]" dir="ltr" aria-live="polite" data-lenis-prevent>
            {log.map((l, i) => (
              <span key={i} className={i === log.length - 1 ? "text-fg" : "text-fg-2"}>
                {l}
                {"\n"}
              </span>
            ))}
            {playing ? <span className="animate-blink">▌</span> : null}
          </pre>
          <p className="text-[0.8rem] leading-relaxed text-muted">
            {fa
              ? `هر گام همان قانون موتور واقعی است: گره‌ای آماده است که همه‌ی ورودی‌هایش تمام شده و دست‌کم یکی فعال باشد؛ تا ${num(lang, 3)} گره موازی اجرا می‌شوند و مسیر ردشده‌ی مسیریاب، آبشاری حذف می‌شود. رأی بازبین را عوض کنید.`
              : "Every step follows the real engine's rule: a node is ready when all its inputs are resolved and at least one is active; up to 3 run in parallel, and the branch a router rejects is skipped in cascade. Flip the reviewer's vote."}
          </p>
        </div>
      </div>
    </div>
  );
}
