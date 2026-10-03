import "server-only";
import { db } from "@/lib/supabase/admin";
import { logEvent, type LogInput } from "@/lib/events";
import { blockModel, connectionState } from "@/lib/connections";
import type { GenContext } from "@/lib/ai/generate";
import type { Job, JobState, NodeState } from "@/lib/types";

export interface GraphSnapshot {
  values: Record<string, unknown>;
  lastNode: string | null;
  next: string[];
}

export interface PartialOutput {
  key: string;
  text: string;
  model?: string;
}

export type StepResult =
  | { type: "continue"; step?: string }
  | { type: "wait"; step: string; leaseSeconds: number }
  | { type: "done"; result?: Record<string, unknown> }
  | { type: "fail"; error: string };

/** A claimed job plus helpers to persist state, stream live status and log events. */
export class JobRun {
  private lastLiveWrite = 0;
  private pendingLive: JobState["live"] | null = null;
  private usage = { input: 0, output: 0, thoughts: 0, calls: 0 };
  /** Heavy per-job data kept out of the realtime-published `jobs` row. */
  data: { graph: GraphSnapshot | null; partial: PartialOutput | null } = { graph: null, partial: null };

  constructor(
    public job: Job,
    public workerId: string,
    public deadline: number,
  ) {
    if (!this.job.state) this.job.state = {};
  }

  async loadData() {
    const { data } = await db().from("job_data").select("graph, partial").eq("job_id", this.job.id).maybeSingle();
    const graph = data?.graph as GraphSnapshot | undefined;
    this.data = { graph: graph && graph.values ? graph : null, partial: (data?.partial as PartialOutput | null) ?? null };
  }

  async saveData() {
    const { error } = await db()
      .from("job_data")
      .upsert({ job_id: this.job.id, graph: this.data.graph ?? {}, partial: this.data.partial, updated_at: new Date().toISOString() });
    if (error) throw new Error(`ذخیره‌ی وضعیت کار: ${error.message}`);
  }

  get state(): JobState {
    return this.job.state;
  }

  timeLeft() {
    return this.deadline - Date.now();
  }

  async save(extra: Partial<Pick<Job, "step" | "external_id" | "external_url" | "result">> = {}) {
    const patch: Record<string, unknown> = { state: this.job.state, updated_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), ...extra };
    Object.assign(this.job, extra);
    await db().from("jobs").update(patch).eq("id", this.job.id);
  }

  async patchState(patch: Partial<JobState>) {
    this.job.state = { ...this.job.state, ...patch };
    await this.save();
  }

  async setNode(key: string, node: Partial<NodeState>) {
    const nodes = { ...(this.job.state.nodes ?? {}) };
    const prev = nodes[key] ?? { status: "pending" };
    const next: NodeState = { ...prev, ...node } as NodeState;
    if (node.status === "running" && !prev.started_at) next.started_at = new Date().toISOString();
    if (node.status === "done") next.finished_at = new Date().toISOString();
    nodes[key] = next;
    this.job.state = { ...this.job.state, nodes };
    await this.save();
  }

  async log(e: Omit<LogInput, "task_id" | "job_id" | "upgrade_id" | "project_id">) {
    await logEvent({ ...e, task_id: this.job.task_id, upgrade_id: this.job.upgrade_id, project_id: this.job.project_id, job_id: this.job.id });
  }

  live(update: JobState["live"]) {
    this.pendingLive = { ...(this.job.state.live ?? {}), ...update, at: new Date().toISOString() };
    const now = Date.now();
    if (now - this.lastLiveWrite < 2_000) return;
    this.lastLiveWrite = now;
    this.job.state = { ...this.job.state, live: this.pendingLive };
    this.pendingLive = null;
    // Supabase query builders are lazy: .then() is required to actually send the request.
    db()
      .from("jobs")
      .update({ state: this.job.state, heartbeat_at: new Date().toISOString() })
      .eq("id", this.job.id)
      .then(({ error }) => error && console.error("live update", error.message));
  }

  /** Model-call hooks bound to this job and the AI connection the call uses. */
  genContext(node: string, connectionId: string): GenContext {
    return {
      getPartial: () => this.data.partial,
      savePartial: async (p) => {
        this.data.partial = p;
        await this.saveData();
      },
      live: (u) => this.live({ node, ...u }),
      log: (e) => this.log(e),
      blockedModels: async () => (await connectionState(connectionId))?.models ?? {},
      blockModel: (model, until, reason) => blockModel(connectionId, model, until, reason),
      addUsage: (u) => {
        this.usage.input += u.input ?? 0;
        this.usage.output += u.output ?? 0;
        this.usage.thoughts += u.thoughts ?? 0;
      },
    };
  }

  /** Fold this step's token usage into the job's cumulative usage (call after each model call). */
  commitUsage() {
    const prev = (this.job.state.usage as { input: number; output: number; thoughts: number; calls: number } | undefined) ?? { input: 0, output: 0, thoughts: 0, calls: 0 };
    this.job.state = {
      ...this.job.state,
      usage: { input: prev.input + this.usage.input, output: prev.output + this.usage.output, thoughts: prev.thoughts + this.usage.thoughts, calls: prev.calls + 1 },
    };
    this.usage = { input: 0, output: 0, thoughts: 0, calls: 0 };
  }
}

export async function bumpLaneStats(lane: "llm" | "external" | "system", patch: Record<string, unknown>) {
  const { data } = await db().from("worker_lanes").select("stats").eq("lane", lane).maybeSingle();
  await db()
    .from("worker_lanes")
    .update({ stats: { ...((data?.stats as Record<string, unknown>) ?? {}), ...patch }, updated_at: new Date().toISOString() })
    .eq("lane", lane);
}
