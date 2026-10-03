import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { verifyRunnerToken } from "@/lib/crypto";
import type { Job } from "@/lib/types";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Who is calling from GitHub Actions: a user's workspace runner (token bound to that user) or the
 * app repository's own self-upgrade runner (the app-wide runner secret).
 */
export function runnerCaller(req: NextRequest): { kind: "user"; userId: string } | { kind: "app" } | null {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  const userId = verifyRunnerToken(token);
  if (userId) return { kind: "user", userId };
  if (env.runnerSecret && safeEqual(header, `Bearer ${env.runnerSecret}`)) return { kind: "app" };
  return null;
}

/** A user's runner may only touch that user's jobs; the app runner only self-upgrade jobs. */
export function mayAccessJob(caller: NonNullable<ReturnType<typeof runnerCaller>>, job: Pick<Job, "owner_id" | "kind">): boolean {
  return caller.kind === "app" ? job.kind === "upgrade" : job.owner_id === caller.userId && job.kind !== "upgrade";
}
