// Windows single sign-on (docs/AD_FA.md «ورود خودکار ویندوز»): two ways a domain-joined PC proves who its person is.
//
// · Negotiate on the server itself: GET /api/auth/sso answers 401 `WWW-Authenticate: Negotiate`, the browser sends a
//   SPNEGO token (a Kerberos ticket for HTTP/<host>), a validator accepts it and names the principal (CORP\ali). On the
//   Windows Server edition the validator is SSPI through the optional native module `node-expose-sspi` (prebuilt N-API
//   binaries for x64/ia32 inside its npm package, so it installs offline; loaded only when a source turns Negotiate on,
//   never on the web version or in the Windows app). Only its raw SSPI binding is used (AcquireCredentialsHandle,
//   AcceptSecurityContext, QueryContextAttributes) — not its Express middleware. The `kerberos` package (mongodb-js)
//   was evaluated and is not used: its server side (initializeServer / KerberosServer.step) throws «not implemented
//   yet for windows», and it downloads its binary at install time. Kerberos only by default: NTLM (a token carrying
//   NTLMSSP) is refused unless the source allows it, and then its second leg is kept per TCP connection.
// · A trusted proxy: IIS with Windows Authentication (or another reverse proxy) authenticates the person and passes the
//   name in a header — believed ONLY from the source's listed proxy addresses (the TCP peer, never X-Forwarded-For) and
//   with the source's shared secret in X-ITSM-Proxy-Secret. Microsoft maintains every moving part of this path.
//
// Tests (real Kerberos is not available) and other hosts inject a validator with setNegotiateValidator.
import { createRequire } from "node:module";
import { join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Ctx, ServerConfig } from "../context";
import { tableDef } from "@shared/tables";
import { ipAllowed } from "@shared/integration/scopes";
import { readSecret } from "../engine";

export interface NegotiateResult {
  /** the person is authenticated (SEC_E_OK) */
  done: boolean;
  /** CORP\ali or ali@CORP.BANK.IR once done */
  principal?: string | null;
  /** the token sent back: the next leg (NTLM) or the mutual authentication of Kerberos */
  response?: Buffer | null;
}

export interface NegotiateValidator {
  name: string;
  /** accept one SPNEGO token; `conn` identifies the TCP connection (NTLM's legs must share it), null when unknown */
  accept(token: Buffer, conn: object | null): Promise<NegotiateResult>;
}

let injected: NegotiateValidator | null | undefined;
let loaded: NegotiateValidator | null | undefined;
let loadError: string | null = null;

/** Use this validator instead of the platform's (tests; a host with its own Kerberos library). Null clears it. */
export function setNegotiateValidator(v: NegotiateValidator | null | undefined): void {
  injected = v;
}

/** The validator of this server, or null where Negotiate cannot run (not Windows, the module not installed). */
export function negotiateValidator(): NegotiateValidator | null {
  if (injected !== undefined) return injected;
  if (loaded !== undefined) return loaded;
  loaded = process.platform === "win32" ? loadSspi() : null;
  if (!loaded && !loadError) loadError = process.platform === "win32" ? "ماژول ورود خودکار ویندوز (node-expose-sspi) نصب نشده است" : "ورود خودکار Kerberos فقط روی ویندوز سرور در دسترس است؛ حالت پراکسی (IIS) را به کار ببرید";
  return loaded;
}

/** Why Negotiate is not available here (for the SSO checklist), or null. */
export function negotiateProblem(): string | null {
  return negotiateValidator() ? null : loadError;
}

// ---------------------------------------------------------------- SSPI (Windows Server)

interface SspiBinding {
  AcquireCredentialsHandle(input: { packageName: string; credentialUse?: string }): { credential: unknown; tsExpiry: Date };
  FreeCredentialsHandle(credential: unknown): void;
  AcceptSecurityContext(input: { credential: unknown; SecBufferDesc: { ulVersion: number; buffers: ArrayBuffer[] }; contextHandle?: unknown }): {
    SECURITY_STATUS: string;
    contextHandle: unknown;
    SecBufferDesc?: { buffers?: ArrayBuffer[] };
  };
  QueryContextAttributes(ctx: unknown, attribute: string): { sUserName?: string };
  DeleteSecurityContext(ctx: unknown): void;
}

/** Load node-expose-sspi's raw binding lazily (a module name in a variable: no bundler follows it). */
function loadSspi(): NegotiateValidator | null {
  const name = "node-expose-sspi/lib/api.js";
  const bases = [process.env.ITSM_NODE_MODULES_DIR, process.cwd(), process.argv[1] ? join(process.argv[1], "..") : null].filter((x): x is string => !!x);
  for (const base of bases) {
    try {
      const req = createRequire(join(base, "noop.js"));
      const mod = req(name) as { sspi?: SspiBinding };
      if (mod?.sspi) return sspiValidator(mod.sspi);
    } catch (e) {
      loadError = `ماژول ورود خودکار ویندوز بار نشد: ${String((e as Error).message ?? e).slice(0, 160)}`;
    }
  }
  return null;
}

function sspiValidator(sspi: SspiBinding): NegotiateValidator {
  let cred: unknown = null;
  let expiry = 0;
  const credential = () => {
    if (!cred || expiry < Date.now() + 60_000) {
      if (cred) sspi.FreeCredentialsHandle(cred);
      const r = sspi.AcquireCredentialsHandle({ packageName: "Negotiate", credentialUse: "SECPKG_CRED_INBOUND" });
      cred = r.credential;
      expiry = new Date(r.tsExpiry).getTime();
    }
    return cred;
  };
  const legs = new WeakMap<object, unknown>();
  return {
    name: "sspi",
    async accept(token, conn) {
      const input: Parameters<SspiBinding["AcceptSecurityContext"]>[0] = {
        credential: credential(),
        SecBufferDesc: { ulVersion: 0, buffers: [token.buffer.slice(token.byteOffset, token.byteOffset + token.byteLength) as ArrayBuffer] },
      };
      const prev = conn ? legs.get(conn) : undefined;
      if (prev) input.contextHandle = prev;
      const out = sspi.AcceptSecurityContext(input);
      const buf = out.SecBufferDesc?.buffers?.[0];
      const response = buf && buf.byteLength ? Buffer.from(buf) : null;
      if (out.SECURITY_STATUS === "SEC_I_CONTINUE_NEEDED") {
        if (conn) legs.set(conn, out.contextHandle);
        return { done: false, response };
      }
      if (conn) legs.delete(conn);
      if (out.SECURITY_STATUS !== "SEC_E_OK") throw new Error(out.SECURITY_STATUS);
      try {
        const names = sspi.QueryContextAttributes(out.contextHandle, "SECPKG_ATTR_NAMES");
        return { done: true, principal: names?.sUserName ?? null, response };
      } finally {
        sspi.DeleteSecurityContext(out.contextHandle);
      }
    },
  };
}

// ---------------------------------------------------------------- tokens

const NTLMSSP = Buffer.from("NTLMSSP\u0000", "latin1");

/** Is a Negotiate token NTLM (raw, or wrapped in SPNEGO) rather than Kerberos? */
export function isNtlmToken(token: Buffer): boolean {
  return token.indexOf(NTLMSSP) >= 0;
}

/** The token of an `Authorization: Negotiate <base64>` header, or null. */
export function negotiateToken(header: string | undefined): Buffer | null {
  const m = /^Negotiate\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header ?? "");
  if (!m) return null;
  const b = Buffer.from(m[1], "base64");
  return b.length ? b : null;
}

// ---------------------------------------------------------------- the trusted proxy

export const PROXY_SECRET_HEADER = "x-itsm-proxy-secret";

/** Is the TCP peer one of the source's proxies? (Never X-Forwarded-For: a client chooses that.) */
export function proxyPeerAllowed(proxyIps: string[], peer: string | null): boolean {
  return !!peer && proxyIps.length > 0 && ipAllowed(peer, proxyIps);
}

/** Does the proxy's shared secret match the source's (compared in constant time)? A source without one trusts nobody. */
export async function proxySecretMatches(cfg: ServerConfig, sys: Ctx, sourceId: string, given: string | undefined): Promise<boolean> {
  if (!given) return false;
  const secret = await readSecret(cfg.db, sys, tableDef("directory_source")!, sourceId, "proxy_secret");
  if (!secret) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}
