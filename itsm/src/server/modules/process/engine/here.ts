// Who advances workflow cases (design F §7.1): the authority — the web version, the server edition, a standalone
// Windows app. A Windows app linked to a web version only records submissions and pushes them; the authority applies
// them when they arrive. Follows `schedulesRunHere` (a linked app leaves the organisation's schedules to the web).
import type { ServerConfig } from "../../../context";
import { schedulesRunHere } from "../../flows/scheduler";

/** Does this runtime apply submissions and run the cases of organisation `orgId`? */
export function processesRunHere(cfg: ServerConfig, orgId: string): Promise<boolean> {
  return schedulesRunHere(cfg, orgId);
}
