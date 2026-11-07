// Helpers of the flows suites (tests/flows-*.test.ts): graphs in a few characters, flows created, published and
// activated through the API, the job queue drained, timers made due.
import { tick } from "@server/jobs";
import type { EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";

export const N = (id: string, type: string, config: Record<string, unknown> = {}, label?: string) => ({ id, type, config, ...(label ? { label } : {}) });
export const E = (source: string, target: string, port?: string) => ({ id: `${source}-${port ?? "out"}-${target}`, source, target, ...(port ? { port } : {}) });

/** A graph: «شروع» → the nodes along `edges` (the trigger node is added). */
export const graph = (nodes: ReturnType<typeof N>[], edges: ReturnType<typeof E>[]) => ({ nodes: [N("trigger", "trigger"), ...nodes], edges });

/** A straight line: trigger → n1 → n2 … */
export const line = (...nodes: ReturnType<typeof N>[]) => graph(nodes, nodes.map((n, i) => E(i ? nodes[i - 1].id : "trigger", n.id)));

let seq = 0;

export interface FlowsKit {
  o: EngineOrg;
  P: string;
  /** create a flow (defaults: manual trigger on todo, run as the triggering member) */
  flow(fields: Record<string, unknown>, g: unknown, client?: Client): Promise<string>;
  publish(id: string, client?: Client): Promise<any>;
  activate(id: string, on?: boolean, client?: Client): Promise<void>;
  /** create, publish and activate */
  live(fields: Record<string, unknown>, g: unknown): Promise<string>;
  /** run due jobs until nothing is due */
  drain(cfg?: EngineOrg["cfg"]): Promise<void>;
  /** make every timer of the queue (and its wait) due now */
  fireTimers(): Promise<void>;
  runs(flowId: string): Promise<any[]>;
  detail(runId: string, client?: Client): Promise<any>;
  todo(fields?: Record<string, unknown>, client?: Client): Promise<any>;
}

export function flowsKit(o: EngineOrg): FlowsKit {
  const P = `/o/${o.org}`;
  const kit: FlowsKit = {
    o,
    P,
    async flow(fields, g, client = o.owner) {
      const r = await client.post(`${P}/r/flow`, { name: `گردش‌کار ${++seq}`, trigger: "manual", trigger_table: "todo", run_as: "trigger_user", ...fields, graph: g });
      return r.row.id as string;
    },
    publish: (id, client = o.owner) => client.post(`${P}/flows/${id}/publish`, {}),
    async activate(id, on = true, client = o.owner) {
      const cur = await client.get(`${P}/r/flow/${id}`);
      await client.patch(`${P}/r/flow/${id}`, { active: on, version: cur.row.version });
    },
    async live(fields, g) {
      const id = await kit.flow(fields, g);
      await kit.publish(id);
      await kit.activate(id);
      return id;
    },
    async drain(cfg = o.cfg) {
      for (let i = 0; i < 100; i++) {
        const r = await tick(cfg, { budgetMs: 20_000 });
        if (!r.more && r.ran + r.failed === 0) return;
      }
    },
    async fireTimers() {
      await o.db.query(`update sm_flow_waits set due_at = now() - interval '1 second' where due_at is not null`);
      await o.db.query(`update sm_jobs set run_at = now() - interval '1 second' where kind = 'flows.timer' and status = 'queued'`);
    },
    async runs(flowId) {
      return (await o.owner.get(`${P}/flows/runs?flow=${flowId}`)).runs;
    },
    detail: (runId, client = o.owner) => client.get(`${P}/flows/runs/${runId}`),
    async todo(fields = {}, client = o.owner) {
      return (await client.post(`${P}/r/todo`, { short_description: `کار ${++seq}`, ...fields })).row;
    },
  };
  return kit;
}

/** Steps of a run as "node:status[:port]". */
export const trail = (d: { steps: { node_id: string; status: string; port: string | null }[] }) => d.steps.map((s) => `${s.node_id}:${s.status}${s.port ? `:${s.port}` : ""}`);
