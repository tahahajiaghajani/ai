"use client";

import { useEffect, useRef, useState } from "react";
import type { Video } from "@/lib/video";
import { motionReduced } from "@/components/fx/motion";

type Connection = { saveData?: boolean; effectiveType?: string };

/** The visitor asked for less data (data saver) or is on a very slow connection. */
function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  return Boolean(c?.saveData) || /(^|-)2g$/.test(c?.effectiveType ?? "");
}

/**
 * A slot's looping background video laid over its picture (place it inside the picture's frame, after the
 * <Picture>). Decorative: muted, no controls, `aria-hidden` (the picture keeps the alt text). It is mounted
 * only after hydration, when motion is allowed (OS setting and the footer toggle), the connection does not ask
 * to save data and the browser can play the type; it loads when the frame comes near the viewport, plays only
 * while on screen and fades in once it can play. Without it, or when it fails, the picture simply stays.
 */
export function SlotVideo({ video, poster, position = "50% 50%", className = "" }: { video: Video | null | undefined; poster?: string; position?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLVideoElement | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = video?.src;
  const type = video?.type;

  // motion and data preferences (re-checked when the footer toggle or the OS setting changes)
  useEffect(() => {
    if (!src || !type) return;
    const probe = document.createElement("video");
    if (!probe.canPlayType(type)) return;
    const check = () => setAllowed(!motionReduced() && !saveData());
    check();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", check);
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => {
      mq.removeEventListener("change", check);
      mo.disconnect();
    };
  }, [src, type]);

  // load when the frame comes near the viewport; play only while it is on screen
  const visible = useRef(false);
  useEffect(() => {
    const target = box.current;
    if (!target || !allowed) return;
    const nearby = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setNear(true);
        nearby.disconnect();
      },
      { rootMargin: "25% 0px" },
    );
    const onScreen = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      const v = el.current;
      if (!v) return;
      if (e.isIntersecting) v.play().catch(() => undefined);
      else v.pause();
    });
    nearby.observe(target);
    onScreen.observe(target);
    return () => {
      nearby.disconnect();
      onScreen.disconnect();
      setReady(false);
    };
  }, [allowed]);

  if (!src || failed) return null;
  return (
    <div ref={box} aria-hidden className={`pointer-events-none absolute inset-0 z-[1] ${className}`}>
      {allowed && near && (
        <video
          ref={(v) => {
            el.current = v;
            // the attribute (not only the property) is what lets iOS start a muted video by itself
            if (v) {
              v.muted = true;
              v.defaultMuted = true;
              v.setAttribute("muted", "");
            }
          }}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          onCanPlay={(e) => {
            setReady(true);
            if (visible.current) e.currentTarget.play().catch(() => undefined);
          }}
          onPlay={(e) => {
            if (!visible.current) e.currentTarget.pause();
          }}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-out ${ready ? "opacity-100" : "opacity-0"}`}
          style={{ objectPosition: position }}
        />
      )}
    </div>
  );
}
