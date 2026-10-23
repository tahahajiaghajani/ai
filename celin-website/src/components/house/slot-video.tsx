"use client";

import { useEffect, useRef, useState } from "react";
import type { Video } from "@/lib/video";
import { motionReduced } from "@/components/fx/motion";

/**
 * A slot's looping background video laid over its picture (the picture stays the poster and the fallback):
 * muted, inline, played only while on screen and never with reduced motion. Fades in once it plays.
 */
export function SlotVideo({ video, className = "" }: { video: Video | null | undefined; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (video && !motionReduced()) setOn(true);
  }, [video]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !on) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && document.visibilityState === "visible") v.play().catch(() => undefined);
      else v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, [on]);

  if (!video || !on) return null;
  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      onPlaying={() => setPlaying(true)}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ${playing ? "opacity-100" : "opacity-0"} ${className}`}
    >
      <source src={video.src} type={video.type} />
    </video>
  );
}
