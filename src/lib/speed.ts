import "server-only";
import { db } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { gh } from "@/lib/github/client";

export interface SpeedReport {
  /** Vercel function region serving this request (null when not on Vercel) */
  region: string | null;
  /** median round-trip of a tiny Supabase query, ms */
  supabaseMs: number;
  samples: number[];
  githubMs: number | null;
  /** the session JWT is signed with the legacy shared secret: every auth check is a network call */
  legacyJwt: boolean | null;
  verdict: "good" | "slow" | "very-slow";
}

async function timed(fn: () => PromiseLike<unknown>): Promise<number> {
  const t = performance.now();
  await fn();
  return Math.round(performance.now() - t);
}

/** Round-trip times from this server to Supabase and GitHub, to tell a region mismatch from slow code. */
export async function measureSpeed(): Promise<SpeedReport> {
  // first call warms the connection (TLS), the rest measure the steady state
  await db().from("provider_state").select("provider").limit(1);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) samples.push(await timed(() => db().from("provider_state").select("provider").limit(1)));
  const sorted = [...samples].sort((a, b) => a - b);
  const supabaseMs = sorted[Math.floor(sorted.length / 2)];

  let githubMs: number | null = null;
  if (env.githubToken) {
    try {
      await gh().rest.rateLimit.get();
      githubMs = await timed(() => gh().rest.rateLimit.get());
    } catch {
      githubMs = null;
    }
  }

  let legacyJwt: boolean | null = null;
  try {
    const { data } = await (await createSupabaseServer()).auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf-8")) as { alg?: string };
      legacyJwt = !header.alg || header.alg.startsWith("HS");
    }
  } catch {
    legacyJwt = null;
  }

  return {
    region: process.env.VERCEL_REGION ?? null,
    supabaseMs,
    samples,
    githubMs,
    legacyJwt,
    verdict: supabaseMs <= 40 ? "good" : supabaseMs <= 120 ? "slow" : "very-slow",
  };
}
