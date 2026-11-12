// Shared set-up of the discovery tests (design A): an organisation on an in-memory server with the CMDB defaults (class
// pack, identification rules), the system context and the module installed, helpers to make connectors, to run a
// connector's pass to its end slice by slice, and to read the module's bookkeeping.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { tick } from "@server/jobs";
import { createIn, systemCtx, updateIn } from "@server/engine";
import type { Ctx } from "@server/context";
import { installDiscoveryModule } from "@server/modules/discovery";
import { runnerFaults, runPull } from "@server/modules/discovery/runner";

export type Row = Record<string, any>;

export interface PassOptions {
  worker?: string;
  /** milliseconds of tick budget each slice gets (a slice is at most 5 s and ends 1 s before it) */
  tickMs?: number;
  reapply?: boolean;
  retryOnly?: boolean;
  /** simulated crashes, armed one after the other (runner.ts crash points) */
  crashes?: string[];
  /** called after every slice */
  onSlice?: (r: unknown) => void | Promise<void>;
}

export interface DiscoveryWorld {
  e: EngineOrg;
  P: string;
  sys: Ctx;
  /** run due jobs until none is left (bounded) */
  drain(rounds?: number): Promise<void>;
  /** a connector created as the system (the module's hook makes its data source) */
  connector(data: Record<string, unknown>): Promise<Row>;
  update(id: string, data: Record<string, unknown>): Promise<Row>;
  /** run a pass of a connector to its end; returns its run row and how many slices it took */
  pass(connectorId: string, opts?: PassOptions): Promise<{ run: Row; slices: number; crashes: number }>;
  q<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T>;
}

export async function discoveryWorld(): Promise<DiscoveryWorld> {
  installDiscoveryModule();
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  await e.owner.post(`${P}/cmdb/seed`, {});
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async (rounds = 30) => {
    for (let i = 0; i < rounds; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const q = <T = Row>(sql: string, params: unknown[] = []) => e.db.query<T>(sql, params);
  const one = async <T = Row>(sql: string, params: unknown[] = []) => (await e.db.one<T>(sql, params)) as T;
  return {
    e,
    P,
    sys,
    drain,
    q,
    one,
    connector: (data) => sys.write((tx) => createIn(tx, sys, "discovery_connector", { every_minutes: 0, ...data }, { trusted: true })),
    update: (id, data) => sys.write((tx) => updateIn(tx, sys, "discovery_connector", id, data, { trusted: true })),
    async pass(connectorId, opts = {}) {
      const crashes = [...(opts.crashes ?? [])];
      runnerFaults.at = crashes.shift() ?? null;
      let slices = 0;
      let crashed = 0;
      try {
        for (let i = 0; i < 5000; i++) {
          let r: unknown;
          try {
            r = await runPull(sys, connectorId, { deadline: Date.now() + (opts.tickMs ?? 60_000) }, { worker: opts.worker ?? "test-worker", trigger: "manual", reapply: opts.reapply, retryOnly: opts.retryOnly });
          } catch (err) {
            if ((err as { code?: string }).code !== "40001") throw err;
            // a crashed worker: its job runs again from what was committed
            crashed++;
            runnerFaults.at = crashes.shift() ?? null;
            continue;
          }
          slices++;
          await opts.onSlice?.(r);
          if (!r) break;
          // a job that comes back later (a retry, a busy lease) comes back at once here, after a breath
          if ((r as { again?: number }).again) await new Promise((res) => setTimeout(res, 20));
        }
      } finally {
        runnerFaults.at = null;
      }
      const run = await one(`select * from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'inventory' order by started_at desc, id desc limit 1`, [e.org, connectorId]);
      return { run, slices, crashes: crashed };
    },
  };
}
