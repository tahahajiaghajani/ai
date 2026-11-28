"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { num, type Lang } from "@/lib/format";
import { mediaUrl, type Media } from "@/lib/media";
import type { Video } from "@/lib/video";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { gsap } from "@/components/fx/gsap";
import { OVERLAY_EVENT, useMotionReduced } from "@/components/fx/motion";
import { SlotVideo } from "@/components/fx/slot-video";
import { DEPTH_EVENT } from "@/components/fx/use-pointer-depth";
import { focusStillHere, handsOnFocus } from "@/components/home/hero-focus";
import { heroPose, offsetOf, poseStyle, ringIndex, ringLength, ringNear, STAGE_RATIO, STEP } from "@/components/home/hero-pose";
import { Icon } from "@/components/ui/icons";

export interface HeroLabels {
  region: string;
  prev: string;
  next: string;
  picture: string;
  of: string;
}

/** every arch asks for the centre's file, so a side never turns soft when it reaches the middle */
const SIZES = "(min-width: 1024px) 27vw, 45vw";
/** a picture rests in the centre this long, then the arcade turns over GLIDE seconds */
const DWELL = 5500;
const GLIDE = 1.6;
/** the opening's unveil (the last curtain: 500 ms + 1.4 s) and the first visit's intro (--intro-delay) */
const UNVEIL = 1900;
const INTRO = 1650;

const cssName = (k: string) => (k === "zIndex" ? "z-index" : k);
const depthOf = (o: number, rtl: boolean) => String(+heroPose(o, rtl).depth.toFixed(2));
const mergeSorted = (a: number[], b: number[]) => (b.every((x) => a.includes(x)) ? a : [...new Set([...a, ...b])].sort((x, y) => x - y));

type Hold = "hover" | "focus" | "drag" | "hidden" | "view" | "overlay";

/**
 * The opening arcade of the home page, turning: any number of pictures go round three arches — the tall centre
 * (keystone, the CTA link) between two lower sides, at exactly the shape, size and hairline rings of the former
 * fixed arcade. Every DWELL a picture glides in from the end side (the left in Persian, the right in English) while
 * the others move along, growing or shrinking between the side and centre shapes (hero-pose.ts); the one leaving
 * fades out past the far side. The arches keep their pointer lean, glints and scroll parting.
 *
 * - Turns by itself only with motion allowed, and rests while the pointer is over the arches, while focus is inside,
 *   while a dialog is open, the tab is hidden or the arcade is out of view; the first turn waits for the unveil.
 * - Controls under the sill (previous / next and a dwell hairline), arrow keys, a swipe on touch, and a click on a
 *   side arch bring a picture to the centre (instantly with reduced motion). Only the centre is a link.
 * - Server-rendered and without JS: exactly the three arches of the first view, still.
 * - The phone picture and the video belong to the first picture and travel with it.
 */
export function HeroArcade({
  lang,
  pictures,
  mobile,
  video,
  href: link,
  cta,
  labels,
  className = "",
}: {
  lang: Lang;
  pictures: Media[];
  mobile: Media | null;
  video: Video | null;
  /** the CTA's address (already in the page language) */
  href: string;
  cta: string;
  labels: HeroLabels;
  className?: string;
}) {
  const router = useRouter();
  const reduced = useMotionReduced();
  const rtl = lang === "fa";
  const n = Math.max(1, pictures.length);
  const L = ringLength(n);

  /** the settled ring position (virtual index in the centre) */
  const [p, setP] = useState(0);
  /** virtual arches rendered so far: the first three on the server, then whatever came within two of the centre */
  const [seen, setSeen] = useState<number[]>(() => ringNear(0, 0, 1, L));
  const [ready, setReady] = useState(false);
  /** the picture the counter shows (the turn's destination) */
  const [current, setCurrent] = useState(0);
  const [announce, setAnnounce] = useState("");
  /** counts the keyboard turns that hand the focus on to the new centre link */
  const [handOn, setHandOn] = useState(0);

  const region = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const arches = useRef(new Map<number, HTMLDivElement>());
  const pos = useRef({ v: 0 });
  const target = useRef(0);
  const tween = useRef<gsap.core.Tween | null>(null);
  const moving = useRef(false);
  /** a keyboard turn from the centre link is under way (cleared when any turn settles) */
  const refocus = useRef(false);
  const swallow = useRef(0);
  const cfg = useRef({ L, n, rtl, reduced, auto: false });
  useLayoutEffect(() => {
    cfg.current = { ...cfg.current, L, n, rtl, reduced };
  });

  // ---------------------------------------------------------------- poses
  const apply = useCallback((v: number) => {
    const { L, rtl } = cfg.current;
    for (const [i, el] of arches.current) {
      const o = offsetOf(i, v, L);
      const style = poseStyle(heroPose(o, rtl));
      for (const k in style) el.style.setProperty(cssName(k), style[k]);
      el.dataset.depth = depthOf(o, rtl);
    }
    // the pointer lean follows the changing depths even while the pointer rests
    stage.current?.dispatchEvent(new Event(DEPTH_EVENT, { bubbles: true }));
  }, []);

  // ---------------------------------------------------------------- the dwell (auto turn) and its hairline
  const timer = useRef({ id: 0, left: 0, since: 0, running: false });
  const holds = useRef(new Set<Hold>());
  const goRef = useRef<(to: number, user: boolean, released?: boolean) => void>(() => undefined);

  const pauseDwell = useCallback(() => {
    const t = timer.current;
    if (!t.running) return;
    clearTimeout(t.id);
    t.left = Math.max(0, t.left - (performance.now() - t.since));
    t.running = false;
    if (bar.current?.hasAttribute("data-run")) bar.current.dataset.run = "paused";
  }, []);

  const runDwell = useCallback(() => {
    const t = timer.current;
    if (t.running || !cfg.current.auto || holds.current.size || moving.current) return;
    t.since = performance.now();
    t.running = true;
    t.id = window.setTimeout(() => {
      t.running = false;
      t.left = 0;
      goRef.current(target.current + 1, false);
    }, t.left);
    if (bar.current?.hasAttribute("data-run")) bar.current.dataset.run = "";
  }, []);

  /** a fresh dwell of `ms` after `delay` ms (the hairline fills over `ms`) */
  const restartDwell = useCallback(
    (ms: number, delay = 0) => {
      const t = timer.current;
      clearTimeout(t.id);
      t.running = false;
      t.left = ms + delay;
      const b = bar.current;
      if (b) {
        b.removeAttribute("data-run");
        if (cfg.current.auto) {
          b.style.setProperty("--dwell", `${ms}ms`);
          b.style.setProperty("--dwell-delay", `${delay}ms`);
          void b.offsetWidth; // restart the animation
          b.dataset.run = "paused";
        }
      }
      runDwell();
    },
    [runDwell],
  );

  const hold = useCallback(
    (why: Hold, on: boolean) => {
      if (on === holds.current.has(why)) return;
      if (on) {
        holds.current.add(why);
        pauseDwell();
      } else {
        holds.current.delete(why);
        runDwell();
      }
    },
    [pauseDwell, runDwell],
  );

  // ---------------------------------------------------------------- turning
  const settle = useCallback(
    (user: boolean) => {
      const { L, n } = cfg.current;
      const v = ringIndex(pos.current.v, L);
      pos.current.v = v;
      target.current = v;
      moving.current = false;
      tween.current = null;
      delete stage.current?.dataset.moving;
      // the old centre stops being a link: a keyboard turn hands the focus on, if it is still on the arches
      if (handsOnFocus(refocus.current, stage.current, document.activeElement)) setHandOn((k) => k + 1);
      refocus.current = false;
      setP(v);
      setSeen((s) => mergeSorted(s, ringNear(v, v, 2, L)));
      if (user) setAnnounce(`${labels.picture} ${num((v % n) + 1, lang)} ${labels.of} ${num(n, lang)}`);
      restartDwell(DWELL);
    },
    [labels, lang, restartDwell],
  );

  /** turns to ring position `to`; `released`: from where a finger let go (the arcade is already moving) */
  const go = useCallback(
    (to: number, user: boolean, released = false) => {
      const { L, n, reduced } = cfg.current;
      const from = pos.current.v;
      target.current = to;
      // every arch the turn passes is rendered before it comes into view
      setSeen((s) => mergeSorted(s, ringNear(from, to, 2, L)));
      setCurrent(ringIndex(to, L) % n);
      pauseDwell();
      const wasMoving = moving.current;
      tween.current?.kill();
      if (reduced) {
        pos.current.v = to;
        apply(to);
        settle(user);
        return;
      }
      moving.current = true;
      if (stage.current) stage.current.dataset.moving = "";
      const steps = Math.abs(to - from);
      tween.current = gsap.to(pos.current, {
        v: to,
        duration: released ? 0.45 + 0.9 * steps : Math.min(2.6, GLIDE + 0.35 * Math.max(0, steps - 1)),
        // a turn that takes over a turn in progress (or a finger) starts at speed
        ease: wasMoving || released ? "power2.out" : "power3.inOut",
        onUpdate: () => apply(pos.current.v),
        onComplete: () => settle(user),
      });
    },
    [apply, pauseDwell, settle],
  );
  useLayoutEffect(() => {
    goRef.current = go;
  }, [go]);

  const step = useCallback((d: number) => go(target.current + d, true), [go]);

  // ---------------------------------------------------------------- lifecycle
  useEffect(() => {
    setReady(true);
    setSeen((s) => mergeSorted(s, ringNear(0, 0, 2, cfg.current.L)));
    const t = timer.current;
    return () => {
      clearTimeout(t.id);
      tween.current?.kill();
    };
  }, []);

  // rests: hidden tab, out of view, an open dialog
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const vis = () => hold("hidden", document.hidden);
    vis();
    document.addEventListener("visibilitychange", vis);
    const io = new IntersectionObserver(([e]) => hold("view", !e.isIntersecting || e.intersectionRatio < 0.25), { threshold: [0, 0.25] });
    io.observe(el);
    const overlay = (e: Event) => hold("overlay", Boolean((e as CustomEvent<{ open?: boolean }>).detail?.open));
    window.addEventListener(OVERLAY_EVENT, overlay);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      io.disconnect();
      window.removeEventListener(OVERLAY_EVENT, overlay);
    };
  }, [hold]);

  // the auto turn: only with motion allowed (live); the first waits for the intro and the unveil
  const first = useRef(true);
  useEffect(() => {
    const auto = ready && !reduced && n > 1;
    cfg.current.auto = auto;
    if (!auto) {
      pauseDwell();
      clearTimeout(timer.current.id);
      bar.current?.removeAttribute("data-run");
      return;
    }
    const intro = document.documentElement.classList.contains("intro-seen") ? 0 : INTRO;
    restartDwell(DWELL, first.current ? intro + UNVEIL : 0);
    first.current = false;
  }, [ready, reduced, n, pauseDwell, restartDwell]);

  // the CTA's page is fetched ahead, as a <Link> would
  useEffect(() => {
    if (link.startsWith("/") && !link.startsWith("//")) router.prefetch(link);
  }, [router, link]);

  // keyboard turns keep the focus on the centre link (the old centre stops being one)
  useEffect(() => {
    if (!handOn || !focusStillHere(stage.current, document.activeElement, document.body)) return;
    stage.current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
  }, [handOn]);

  // ---------------------------------------------------------------- input
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    refocus.current = Boolean(stage.current?.contains(document.activeElement));
    // the next picture waits on the left in Persian, on the right in English
    step((e.key === "ArrowLeft") === rtl ? 1 : -1);
  };

  const onFocus = () => hold("focus", true);
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!region.current?.contains(e.relatedTarget as Node | null)) hold("focus", false);
  };

  const drag = useRef<{ id: number; x: number; y: number; v0: number; w: number; on: boolean; t: number; lx: number; vel: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || !e.isPrimary || !stage.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, v0: pos.current.v, w: (stage.current.clientWidth * STEP) / 100, on: false, t: e.timeStamp, lx: e.clientX, vel: 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // the page scrolls
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      // take the arcade from wherever it is (a turn in progress stops under the finger)
      d.on = true;
      tween.current?.kill();
      tween.current = null;
      moving.current = false;
      d.v0 = pos.current.v;
      d.x = e.clientX;
      d.lx = e.clientX;
      d.t = e.timeStamp;
      stage.current?.setPointerCapture(e.pointerId);
      if (stage.current) stage.current.dataset.moving = "";
      hold("drag", true);
      setSeen((s) => mergeSorted(s, ringNear(d.v0 - 1, d.v0 + 1, 2, cfg.current.L)));
      return;
    }
    // a finger moving towards the start side pulls the next picture in
    const dir = rtl ? 1 : -1;
    const v = Math.min(d.v0 + 1.2, Math.max(d.v0 - 1.2, d.v0 + (dir * (e.clientX - d.x)) / d.w));
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.vel = 0.7 * d.vel + (0.3 * (dir * (e.clientX - d.lx))) / d.w / dt;
    d.t = e.timeStamp;
    d.lx = e.clientX;
    pos.current.v = v;
    apply(v);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!d.on) return;
    swallow.current = performance.now();
    const base = Math.round(d.v0);
    const fling = Math.abs(d.vel) > 0.0015 ? Math.sign(d.vel) * 0.4 : 0;
    go(Math.min(base + 1, Math.max(base - 1, Math.round(pos.current.v + fling))), true, true);
    hold("drag", false);
  };

  const onArchClick = (i: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (performance.now() - swallow.current < 400) {
      e.preventDefault();
      return;
    }
    const o = offsetOf(i, target.current, cfg.current.L);
    if (o !== 0) {
      // a side arch comes to the centre
      e.preventDefault();
      go(target.current + o, true);
      return;
    }
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!link.startsWith("/") || link.startsWith("//")) return;
    e.preventDefault();
    router.push(link);
  };

  // ---------------------------------------------------------------- render
  const shown = (i: number) => pictures[i % n] ?? pictures[0];
  return (
    <div ref={region} role="region" aria-label={labels.region} className={className} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur}>
      <div
        ref={stage}
        data-hero-stage
        className="relative isolate touch-pan-y touch-pinch-zoom"
        style={{ aspectRatio: STAGE_RATIO }}
        onPointerEnter={(e) => e.pointerType === "mouse" && hold("hover", true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hold("hover", false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div data-part="lines" className="pointer-events-none absolute inset-x-[-20%] bottom-0 top-[-16%] origin-bottom" data-depth="-4">
          <ArchLines count={5} tone="champagne" immediate delay={100} className="size-full" />
        </div>
        {seen.map((i) => {
          const o = offsetOf(i, p, L);
          const centre = o === 0;
          const side = Math.abs(o) === 1;
          const m = shown(i);
          const k = i % n;
          // the first view unveils after the intro, as the fixed arcade did; arches rendered later never replay it
          const opening = i === 0 || i === 1 || i === L - 1;
          return (
            <div
              key={`v${i}`}
              ref={(el) => {
                if (el) arches.current.set(i, el);
                else arches.current.delete(i);
              }}
              className="hero-item"
              style={poseStyle(heroPose(o, rtl)) as CSSProperties}
              data-depth={depthOf(o, rtl)}
              aria-hidden={centre ? undefined : true}
              inert={!centre && !side ? true : undefined}
            >
              <a
                href={centre ? link : undefined}
                aria-label={centre ? cta : undefined}
                data-cursor={centre ? "view" : undefined}
                className="block size-full"
                draggable={false}
                onClick={onArchClick(i)}
              >
                <Arch
                  media={m}
                  mobile={k === 0 ? mobile : null}
                  lang={lang}
                  sizes={SIZES}
                  ratio={null}
                  className="size-full"
                  priority={i === 0}
                  eager={ready && i !== 0}
                  ring="champagne"
                  keystone
                  unveil={opening}
                  afterIntro={opening}
                  delay={i === 0 ? 150 : i === L - 1 ? 350 : 500}
                  sparkle={centre ? 14 : side ? 6 : undefined}
                >
                  {k === 0 && video && (centre || side) && <SlotVideo video={video} poster={mediaUrl(m, 960)} position={`${m.fx}% ${m.fy}%`} />}
                </Arch>
              </a>
            </div>
          );
        })}
      </div>
      {/* the sill */}
      <span aria-hidden className="mx-auto mt-0 block h-px w-[110%] -translate-x-[4.5%] bg-[image:var(--metal-champagne)] opacity-60 rtl:translate-x-[4.5%]" />
      {/* the controls (in the bottom margin on desktop, so the arcade stays where it was) */}
      {n > 1 && (
        <div data-hero-controls data-ready={ready ? "" : undefined} className="mt-5 flex items-center justify-center gap-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:h-[6.5vh] lg:min-h-11">
          <button type="button" onClick={() => step(-1)} aria-label={labels.prev} className="btn btn-line-light btn-sm size-10 min-h-0 px-0 lg:size-9">
            <Icon name="chevron" className="size-4 -scale-x-100 rtl:scale-x-100" />
          </button>
          <span aria-hidden className="flex items-center gap-3 font-label text-xs text-on-night-muted tabular-nums">
            <span className="min-w-[2ch] text-center text-on-night">{num(current + 1, lang)}</span>
            <span className="relative block h-px w-10 overflow-hidden bg-on-night/20">
              <span ref={bar} className="hero-dwell absolute inset-0 bg-[image:var(--metal-champagne)]" />
            </span>
            <span className="min-w-[2ch] text-center">{num(n, lang)}</span>
          </span>
          <button type="button" onClick={() => step(1)} aria-label={labels.next} className="btn btn-line-light btn-sm size-10 min-h-0 px-0 lg:size-9">
            <Icon name="chevron" className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
