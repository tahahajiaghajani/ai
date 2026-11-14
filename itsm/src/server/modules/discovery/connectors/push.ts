// The «ارسال از ابزار (API)» kind (design A §12): nothing is pulled — the tool sends batches, statuses and problem sets
// to /api/v1/discovery/<connector>/… (push.ts, routes/discovery-api.ts). A pull of a push connector lists nothing and
// is never complete (no item goes «gone» on a pull: only a complete snapshot says what is gone); it still runs the
// pass's refresh and retry phases over what was pushed.
import { z } from "zod";
import { push as descriptor } from "@shared/discovery/kinds/push";
import type { Page, TestResult } from "@shared/discovery/types";
import type { ConnectorKind } from "../kind";

const options = z.object({ availability_match: z.string().trim().max(300).optional() }).passthrough();

export const connector: ConnectorKind = {
  ...descriptor,
  headers: [],
  optionsSchema: options,
  async test(): Promise<TestResult> {
    return { ok: true, identity: "ارسال از ابزار", warnings: [] };
  },
  async pages(): Promise<Page> {
    return { records: [], next: null, complete: false };
  },
};
