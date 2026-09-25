import "server-only";
import { db } from "@/lib/supabase/admin";
import { dispatchExternal, watchExternal, type ExternalOptions } from "@/lib/queue/handlers/external";
import type { JobRun, StepResult } from "@/lib/queue/run";

const OPTS: ExternalOptions = { repo: "app", workflow: "self-upgrade.yml", leaseSeconds: 3 * 3600, label: "ارتقای اپ" };

export async function upgradeHandler(run: JobRun): Promise<StepResult> {
  const step = run.job.step ?? "dispatch";
  if (step === "dispatch") {
    await db().from("upgrades").update({ status: "running" }).eq("id", run.job.upgrade_id);
    return dispatchExternal(run, OPTS);
  }
  return watchExternal(run, OPTS);
}

export async function graphifyHandler(run: JobRun): Promise<StepResult> {
  const opts: ExternalOptions = { repo: "workspace", workflow: "graphify.yml", leaseSeconds: 40 * 60, label: "graphify" };
  const step = run.job.step ?? "dispatch";
  if (step === "dispatch") return dispatchExternal(run, opts);
  return watchExternal(run, opts);
}
