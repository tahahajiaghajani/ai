// The fixture CA of the discovery tests (design A §17): a bank-like private root and the certificates it signs for a
// tool at tool.bank.test (also localhost) — a good one, an expired one, one for another name — plus an unrelated root
// that trusts none of them. Made in memory when first asked for (X.509 v3, ECDSA P-256, tests/ldap-fake.ts makeCert),
// so no private key ever sits in the repository and no openssl is needed (the Windows runner has none). A client that
// needs files — the relay's tests, the bank simulation's LAN mock — writes them with `writeFixtureCa(dir)`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCert, type Cert } from "../../ldap-fake";

export const TOOL_HOST = "tool.bank.test";

export interface FixtureCa {
  /** the bank's private root (what a connector's «گواهی ریشهٔ ابزار» holds) */
  ca: Cert;
  /** the tool's certificate for tool.bank.test and localhost, signed by the root */
  tool: Cert;
  /** the same names, expired ten days ago */
  expired: Cert;
  /** signed by the root for another name only */
  wrongName: Cert;
  /** a root that signed none of these */
  otherCa: Cert;
}

let made: FixtureCa | null = null;

/** The fixture CA of this test process (made once). */
export function fixtureCa(): FixtureCa {
  if (made) return made;
  const ca = makeCert({ cn: "Kariz Test Bank Root CA", ca: true });
  const tool = makeCert({ cn: TOOL_HOST, issuer: ca, dns: [TOOL_HOST, "localhost"] });
  const expired = makeCert({ cn: TOOL_HOST, issuer: ca, dns: [TOOL_HOST, "localhost"], notBefore: new Date(Date.now() - 40 * 86_400_000), notAfter: new Date(Date.now() - 10 * 86_400_000) });
  const wrongName = makeCert({ cn: "other.bank.test", issuer: ca, dns: ["other.bank.test"] });
  const otherCa = makeCert({ cn: "Kariz Test Unrelated Root CA", ca: true });
  made = { ca, tool, expired, wrongName, otherCa };
  return made;
}

/** Write the root and the tool's certificate and key as PEM files (ca.pem, tool.pem, tool.key) into `dir`. */
export function writeFixtureCa(dir: string): { ca: string; cert: string; key: string } {
  const f = fixtureCa();
  mkdirSync(dir, { recursive: true });
  const out = { ca: join(dir, "ca.pem"), cert: join(dir, "tool.pem"), key: join(dir, "tool.key") };
  writeFileSync(out.ca, f.ca.pem);
  writeFileSync(out.cert, f.tool.pem);
  writeFileSync(out.key, f.tool.key, { mode: 0o600 });
  return out;
}
