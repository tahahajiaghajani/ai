import "server-only";
import { db } from "@/lib/supabase/admin";
import { githubInfo, type GithubConfig } from "@/lib/connections";
import { setGraphifySecret } from "@/lib/github/bootstrap";
import { dispatchExternal, watchExternal, type ExternalOptions } from "@/lib/queue/handlers/external";
import type { JobRun, StepResult } from "@/lib/queue/run";

const OPTS: ExternalOptions = { workflow: "self-upgrade.yml", app: true, leaseSeconds: 3 * 3600, label: "ارتقای اپ" };

/** Owner only: Claude Code changes the app itself in the app repository and opens a pull request. */
export async function upgradeHandler(run: JobRun): Promise<StepResult> {
  const step = run.job.step ?? "dispatch";
  if (step === "dispatch") {
    await db().from("upgrades").update({ status: "running" }).eq("id", run.job.upgrade_id);
    return dispatchExternal(run, OPTS);
  }
  return watchExternal(run, OPTS);
}

/** graphify maps a project (code and documents) in the user's GitHub Actions. */
export async function graphifyHandler(run: JobRun): Promise<StepResult> {
  const opts: ExternalOptions = { workflow: "graphify.yml", leaseSeconds: 40 * 60, label: "graphify" };
  const step = run.job.step ?? "dispatch";
  if (step === "dispatch") {
    const gh = await githubInfo(run.job.owner_id!);
    // documents are mapped with the user's Google key when they have one; code needs no key
    if (gh && !(gh.config as GithubConfig).geminiSecret) await setGraphifySecret(run.job.owner_id!).catch(() => false);
    return dispatchExternal(run, opts);
  }
  return watchExternal(run, opts);
}
