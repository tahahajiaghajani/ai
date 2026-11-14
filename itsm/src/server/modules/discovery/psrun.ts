// The fixed-script PowerShell runner (design A §6.4, §6.5): the server edition on Windows reaches a few tools only
// through Windows itself — MECM's AdminService with the service account's own identity when the in-process Negotiate
// module cannot be loaded (DA3b), a SQL Server view through System.Data.SqlClient (DA3c). A child process sits outside
// the process's socket guard, so the runner is hardened:
//   · only scripts fixed in code run (`PS_SCRIPTS`; a package adds its script here, a person never names a file or
//     types a command): each is written to a private folder and checked against its hash before every run;
//   · `-NoProfile -NonInteractive -File <fixed>`, with each value bound to a declared parameter of the script — never
//     parsed as code — and refused when it carries a line break, a quote, a NUL or more than 4 000 characters;
//   · the pinned host is judged first exactly like a connector's own request (net.ts checkHost: the self and database
//     refusal, the air-gap allowlist, the exact-name rule when credentials go out); a script's `Uri` must then name
//     that host and no other — https, or http only with the connector's «اتصال بدون رمزنگاری» tick, no credentials in
//     it — so a caller cannot aim the script anywhere else;
//   · a password goes on stdin, never on the command line;
//   · 30 s by default, the window hidden, output capped at 20 MB; the script's own markers become Persian answers —
//     a redirect (`-MaximumRedirection 0`, so Windows credentials never follow one) is «پاسخ به نشانی دیگری هدایت شد…»;
//   · demo work never starts it (§14.4): nothing of the demo pack leaves the system, as for the fetcher (net.ts).
// Only the server edition on Windows runs it; elsewhere it refuses with a Persian message.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNotDemoOutbound, DemoOutboundError } from "../../db/scope";
import { ConnectorError, CONNECTOR_MESSAGES } from "./kind";
import { addressProblem, checkHost, editionOf, type NetConfig } from "./net";

/** A script fixed in code: its text and the parameters it declares (the only names an argument may have). */
export interface PsScript {
  name: string;
  params: readonly string[];
  text: string;
}

/**
 * GET one URL with the service account's Windows identity (§6.4 fallback): no redirect is followed (credentials never
 * follow one), the body comes back raw — not through ConvertTo-Json, which cuts nested objects at depth 2.
 */
const WEB_REQUEST = `param(
  [Parameter(Mandatory = $true)][string]$Uri,
  [int]$TimeoutSec = 30
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $r = Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -MaximumRedirection 0 -TimeoutSec $TimeoutSec -Uri $Uri -Headers @{ Accept = 'application/json' }
  $code = [int]$r.StatusCode
  if ($code -ge 300 -and $code -lt 400) { [Console]::Error.Write('KARIZ:redirect'); exit 3 }
  [Console]::Out.Write($r.Content)
  exit 0
} catch {
  $resp = $_.Exception.Response
  if ($resp -ne $null) {
    $code = [int]$resp.StatusCode
    if ($code -ge 300 -and $code -lt 400) { [Console]::Error.Write('KARIZ:redirect'); exit 3 }
    [Console]::Error.Write("KARIZ:status:$code"); exit 4
  }
  [Console]::Error.Write('KARIZ:network'); exit 5
}
`;

/** The scripts the runner knows (DA3b and DA3c add theirs here). */
export const PS_SCRIPTS: Readonly<Record<string, PsScript>> = Object.freeze({
  web_request: { name: "web_request", params: ["Uri", "TimeoutSec"], text: WEB_REQUEST },
});

export const PS_TIMEOUT_MS = 30_000;
export const PS_MAX_OUTPUT = 20 * 1024 * 1024;
const MAX_ARG = 4000;
const PARAM = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const normHost = (h: string) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");

export const PS_MESSAGES = {
  windowsOnly: "این روش اتصال فقط در نسخهٔ سرور روی ویندوز به کار می‌رود",
  unknownScript: "این دستور PowerShell شناخته نیست",
  badArgument: (name: string) => `مقدار «${name}» برای PowerShell پذیرفته نیست (خط تازه، گیومه، نویسهٔ تهی یا بیش از ۴۰۰۰ نویسه)`,
  failed: "PowerShell کار را به پایان نرساند",
  timeout: "PowerShell در زمان مقرر پاسخ نداد",
} as const;

/** The command line of one run: the fixed flags, the script file and each value bound to its declared parameter. */
export function psArgs(script: PsScript, file: string, args: Record<string, string | number>): string[] {
  const out = ["-NoProfile", "-NonInteractive", "-File", file];
  for (const [k, raw] of Object.entries(args)) {
    if (!PARAM.test(k) || !script.params.includes(k)) throw new ConnectorError("config", PS_MESSAGES.badArgument(k));
    const v = String(raw);
    // Windows rebuilds one command line from the values: a quote could break out of its value there
    if (v.length > MAX_ARG || /[\r\n\0"]/.test(v)) throw new ConnectorError("config", PS_MESSAGES.badArgument(k));
    // a value that starts with «-» would be read as a parameter name: bound with a colon, it stays a value
    out.push(`-${k}:${v}`);
  }
  return out;
}

/** Test seam: the platform, the PowerShell executable and the spawn (tests run the runner on Linux). */
export const psrunSeam = {
  platform: (): NodeJS.Platform => process.platform,
  powershell: (): string => path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  exec: (file: string, args: string[], opts: { timeout: number; maxBuffer: number; stdin?: string }): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> =>
    new Promise((resolve) => {
      const child = execFile(file, args, { timeout: opts.timeout, maxBuffer: opts.maxBuffer, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string }) | null;
        resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut: !!e && (e.killed === true || e.signal === "SIGTERM") });
      });
      child.stdin?.end(opts.stdin ?? "");
    }),
};

let folder: string | null = null;
/** The script's file in this process's private folder, written again whenever its content is not the fixed text. */
function scriptFile(script: PsScript): string {
  if (!folder || !existsSync(folder)) {
    const base = path.join(os.tmpdir(), "kariz-ps");
    mkdirSync(base, { recursive: true, mode: 0o700 });
    folder = mkdtempSync(path.join(base, `${process.pid}-`));
  }
  const digest = createHash("sha256").update(script.text).digest("hex");
  const file = path.join(folder, `${script.name}-${digest.slice(0, 12)}.ps1`);
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    current = "";
  }
  if (createHash("sha256").update(current).digest("hex") !== digest) writeFileSync(file, script.text, { encoding: "utf8", mode: 0o600 });
  return file;
}

export interface PsRun {
  /** a script of PS_SCRIPTS */
  script: string;
  /** the pinned host the script reaches (judged like a connector's own request before anything starts) */
  host: string;
  /** the script sends credentials (the service account's identity, a SQL login): exact allowlist names only */
  credentialed: boolean;
  /** the connector's «اتصال بدون رمزنگاری» tick: an http:// `Uri` only with it */
  plainHttp?: boolean;
  args: Record<string, string | number>;
  /** a password or other secret (never on the command line) */
  stdin?: string;
  timeoutMs?: number;
  /** the connector's name (messages) */
  label?: string;
}

/** Run a fixed script for a connector (§6.4, §6.5): its standard output, or a ConnectorError with the Persian cause. */
export async function runPs(cfg: NetConfig, run: PsRun): Promise<string> {
  // nothing of the demo pack leaves the system (§14.4): demo work never starts a child process that calls out
  try {
    assertNotDemoOutbound();
  } catch (e) {
    if (e instanceof DemoOutboundError) throw new ConnectorError("refused", CONNECTOR_MESSAGES.demo);
    throw e;
  }
  if (psrunSeam.platform() !== "win32" || editionOf(cfg) !== "server") throw new ConnectorError("config", PS_MESSAGES.windowsOnly);
  const script = PS_SCRIPTS[run.script];
  if (!script) throw new ConnectorError("config", PS_MESSAGES.unknownScript);
  // the same checks as a connector's own request, before the child process exists
  await checkHost(cfg, run.host, { credentialed: run.credentialed });
  // the script's address names the judged host and no other
  if (Object.prototype.hasOwnProperty.call(run.args, "Uri")) {
    const uri = String(run.args.Uri);
    const problem = addressProblem(uri, { plainHttp: run.plainHttp === true, edition: "server" });
    if (problem) throw new ConnectorError("refused", problem);
    if (normHost(new URL(uri).hostname) !== normHost(run.host)) throw new ConnectorError("refused", CONNECTOR_MESSAGES.otherHost);
  }
  const args = psArgs(script, scriptFile(script), run.args);
  const r = await psrunSeam.exec(psrunSeam.powershell(), args, { timeout: run.timeoutMs ?? PS_TIMEOUT_MS, maxBuffer: PS_MAX_OUTPUT, stdin: run.stdin });
  if (r.code === 0) return r.stdout;
  if (r.timedOut) throw new ConnectorError("network", run.label ? CONNECTOR_MESSAGES.noAnswer(run.label) : PS_MESSAGES.timeout);
  const marker = /KARIZ:([a-z_]+)(?::(\d{3}))?/.exec(r.stderr);
  if (marker?.[1] === "redirect") throw new ConnectorError("refused", CONNECTOR_MESSAGES.redirect);
  if (marker?.[1] === "status") {
    const status = Number(marker[2]);
    if (status === 401 || status === 403) throw new ConnectorError("auth", CONNECTOR_MESSAGES.auth, { status });
    if (status >= 500 || status === 429) throw new ConnectorError("network", CONNECTOR_MESSAGES.noAnswer(run.label ?? run.host), { status });
    throw new ConnectorError("bad_response", CONNECTOR_MESSAGES.status(status), { status });
  }
  if (marker?.[1] === "network") throw new ConnectorError("network", CONNECTOR_MESSAGES.noAnswer(run.label ?? run.host));
  throw new ConnectorError("bad_response", PS_MESSAGES.failed);
}
