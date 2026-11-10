// Small helpers shared by the performance scripts (pg-local, seed-bank, loadtest, explain-bank).
import { loadavg } from "node:os";

/** The 1/5/15-minute load averages, as `uptime` prints them (recorded with every measurement: the CPUs are shared). */
export function loavg() {
  return loadavg()
    .map((x) => x.toFixed(2))
    .join(", ");
}
