// The bank's domain controller of the simulation (docs/qa/BANK_SIM_FA.md): the fake Active Directory of the test suite
// (tests/ldap-fake.ts: simple binds with AD's sub-codes, filters, nested groups, paged results), bundled here with
// esbuild and served over LDAPS on the runner's LAN address with a certificate the bank's test CA issued for
// dc1.bank.local (a PFX made with PowerShell). The directory: a read-only service account, two agents (one of them in
// a nested group), a branch employee and the groups the guide (docs/AD_FA.md) suggests.
//
//   node ldap-mock.mjs --host 10.1.0.5 --port 636 --pfx dc1.pfx --passphrase … --log ldap.json
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, log } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const a = parseArgs();
const outfile = join(ROOT, "node_modules", ".cache", "bank-sim", `ldap-fake-${process.pid}.mjs`);
mkdirSync(dirname(outfile), { recursive: true });
await build({ entryPoints: [join(ROOT, "tests", "ldap-fake.ts")], bundle: true, platform: "node", format: "esm", outfile, tsconfig: join(ROOT, "tsconfig.json"), logLevel: "error" });
const fake = await import(pathToFileURL(outfile).href);
const { BASE, SVC, fakeLdap, group, person, serviceAccount } = fake;

const GROUPS = `OU=Groups,${BASE}`;
const ali = person("ali", { name: "Ali Rezaei", mail: "ali@corp.test", extra: { title: ["کارشناس شبکه"], department: ["فناوری اطلاعات"] } });
const maryam = person("maryam", { name: "Maryam Karimi", mail: "maryam@corp.test", extra: { department: ["فناوری اطلاعات"] } });
const sara = person("sara", { name: "Sara Ahmadi", mail: "sara@corp.test", extra: { department: ["شعبهٔ مرکزی"] } });
const entries = [
  serviceAccount(),
  ali,
  maryam,
  sara,
  group("Kariz-Agents-Network", [ali.dn]),
  group("Kariz-Agents", [`CN=Kariz-Agents-Network,${GROUPS}`, maryam.dn]),
  group("Kariz-Users", [ali.dn, maryam.dn, sara.dn]),
];

const dc = await fakeLdap(entries, {
  mode: "ldaps",
  tlsOptions: { pfx: readFileSync(String(a.pfx)), passphrase: String(a.passphrase ?? ""), minVersion: "TLSv1.2" },
  listen: { host: String(a.host ?? "127.0.0.1"), port: Number(a.port ?? 636) },
});
log(`ldap: LDAPS on ${dc.url} (base ${BASE}, service account ${SVC.dn})`);
// what the installed server sent: connections, binds (names only) and filters — written every few seconds
const info = { base: BASE, service_dn: SVC.dn, service_password: SVC.password, agents_group: `CN=Kariz-Agents,${GROUPS}`, users: { ali: "Passw0rd!", maryam: "Passw0rd!", sara: "Passw0rd!" } };
if (a.info) writeFileSync(String(a.info), JSON.stringify(info, null, 2));
setInterval(() => {
  if (a.log) writeFileSync(String(a.log), JSON.stringify({ connections: dc.connections, binds: dc.binds, filters: dc.filters.slice(-50) }, null, 2));
}, 3000);
