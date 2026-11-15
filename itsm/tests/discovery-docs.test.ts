// The data sources' guide (docs/modules/discovery_FA.md, design A DA5): its troubleshooting table lists every Persian
// message the module answers people and tools with, so a bank's IT finds each one there. A message changed or added in
// the code without the guide fails here. Variable parts («…» in the guide) are left out of the comparison; ZWNJ, digit
// forms and spacing are not compared. Left out on purpose: the messages of the kinds that come with 1.2 (software
// collection, the AD-computers kind's directory, the PowerShell kinds) and the feed's success summary.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONNECTOR_MESSAGES } from "@server/modules/discovery/kind";
import { DROP_MESSAGES } from "@server/modules/discovery/drop";
import { FEED_MESSAGES } from "@server/modules/discovery/connectors/feed";
import { ZABBIX_MESSAGES } from "@server/modules/discovery/connectors/zabbix";
import { PRTG_MESSAGES } from "@server/modules/discovery/connectors/prtg";
import { VCENTER_MESSAGES } from "@server/modules/discovery/connectors/vcenter";
import { PUSH_MESSAGES } from "@server/modules/discovery/push";
import { STRONG_ONLY_MESSAGE } from "@server/modules/discovery/device";
import { ADMIN_ONLY_MESSAGE, ASSET_ONLY_MESSAGE, DEMO_PEOPLE_MESSAGE, OWNER_ONLY_MESSAGE, SECRETS_CLEARED } from "@server/modules/discovery/guard";
import { LINK_WRITE_MESSAGE, OPERATOR_MESSAGE, READ_MESSAGE } from "@server/modules/discovery/service";
import { STATUS_READ_MESSAGE } from "@server/modules/discovery/status";
import { capWarning, NOT_CONFIRMED_MESSAGE } from "@server/modules/discovery/itamfeed";
import { REFUSED_FIELD_MESSAGE } from "@shared/discovery/mapping";
import {
  LONG_EXTERNAL_ID, NO_EXTERNAL_ID, NOT_A_RECORD, OWNED_FIELD_DROPPED, OWNED_FIELD_WARNING, RESERVED_ATTR_DROPPED, SECRET_ATTR_DROPPED, UNKNOWN_FIELD_DROPPED,
} from "@shared/discovery/normalise";
import { MASS_DROP_WARNING } from "@shared/discovery/stale";

const GUIDE = readFileSync(join(__dirname, "..", "docs", "modules", "discovery_FA.md"), "utf8");

/** What is compared: no ZWNJ or direction marks, Latin digits, Persian ی and ک, single spaces. */
const norm = (s: string) =>
  s
    .replace(/[‌‎‏‪-‮]/g, "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();

/** A placeholder no message contains: where a message's variable part goes. */
const HOLE = "\u0007";

/** A message's fixed text, cut where its variable parts go (a function is called with placeholders). */
function fixedParts(message: unknown): string[] {
  let text: string;
  if (typeof message === "function") {
    const fn = message as (...a: unknown[]) => string;
    const args = (v: unknown) => Array.from({ length: Math.max(1, fn.length) }, () => v);
    try {
      text = String(fn(...args(HOLE)));
    } catch {
      text = String(fn(...args([HOLE])));
    }
  } else text = String(message);
  return text
    .split(HOLE)
    .map(norm)
    .filter((p) => p.replace(/[«»()؛،:.\s]/g, "").length >= 2);
}

const MESSAGES: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(CONNECTOR_MESSAGES).map(([k, v]) => [`connector.${k}`, v])),
  ...Object.fromEntries(Object.entries(DROP_MESSAGES).map(([k, v]) => [`drop.${k}`, v])),
  ...Object.fromEntries(Object.entries(FEED_MESSAGES).filter(([k]) => k !== "summary").map(([k, v]) => [`feed.${k}`, v])),
  ...Object.fromEntries(Object.entries(ZABBIX_MESSAGES).map(([k, v]) => [`zabbix.${k}`, v])),
  ...Object.fromEntries(Object.entries(PRTG_MESSAGES).map(([k, v]) => [`prtg.${k}`, v])),
  ...Object.fromEntries(Object.entries(VCENTER_MESSAGES).map(([k, v]) => [`vcenter.${k}`, v])),
  ...Object.fromEntries(Object.entries(PUSH_MESSAGES).map(([k, v]) => [`push.${k}`, v])),
  STRONG_ONLY_MESSAGE, ADMIN_ONLY_MESSAGE, OWNER_ONLY_MESSAGE, ASSET_ONLY_MESSAGE, SECRETS_CLEARED, DEMO_PEOPLE_MESSAGE,
  READ_MESSAGE, OPERATOR_MESSAGE, LINK_WRITE_MESSAGE, STATUS_READ_MESSAGE, NOT_CONFIRMED_MESSAGE, capWarning, REFUSED_FIELD_MESSAGE,
  NO_EXTERNAL_ID, LONG_EXTERNAL_ID, NOT_A_RECORD, OWNED_FIELD_WARNING, OWNED_FIELD_DROPPED, UNKNOWN_FIELD_DROPPED, RESERVED_ATTR_DROPPED,
  SECRET_ATTR_DROPPED, MASS_DROP_WARNING,
};

describe("the data sources' guide lists every message", () => {
  const troubleshooting = norm(GUIDE.slice(GUIDE.indexOf("## عیب‌یابی")));

  it("has a troubleshooting section", () => {
    expect(GUIDE.indexOf("## عیب‌یابی")).toBeGreaterThan(0);
    expect(Object.keys(MESSAGES).length).toBeGreaterThan(80);
  });

  it.each(Object.entries(MESSAGES))("%s", (_name, message) => {
    const parts = fixedParts(message);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(troubleshooting, `«${part}» is not in the troubleshooting table`).toContain(part);
  });
});
