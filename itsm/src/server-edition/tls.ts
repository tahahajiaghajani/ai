// TLS of the server edition: the bank's certificate (PKCS#12 .pfx with its password, or PEM certificate chain + key)
// from the configuration, or — until one is installed by the first-run setup or `karizctl rotate-cert` — a self-signed
// certificate generated here for the public host name (RSA 2048, SHA-256, SAN with the name, the machine's name and
// 127.0.0.1). TLS 1.2 is the minimum and only forward-secret AEAD suites are offered on 1.2.
import { X509Certificate, createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createSecureContext, type SecureContextOptions } from "node:tls";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import type { ServerEditionConfig } from "./config";

// ----- a minimal DER encoder (enough for one X.509 v3 certificate) ------------------------------------------------

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const nul = () => Buffer.from([0x05, 0x00]);
const ctx = (n: number, body: Buffer, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);

function oid(s: string): Buffer {
  const p = s.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const stack = [v & 0x7f];
    let x = Math.floor(v / 128);
    while (x > 0) {
      stack.unshift((x & 0x7f) | 0x80);
      x = Math.floor(x / 128);
    }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function int(b: Buffer): Buffer {
  let body = b;
  while (body.length > 1 && body[0] === 0 && !(body[1] & 0x80)) body = body.subarray(1);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const octets = (b: Buffer) => tlv(0x04, b);

function time(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  // UTCTime until 2049, GeneralizedTime after (RFC 5280 §4.1.2.5)
  return y < 2050 ? tlv(0x17, Buffer.from(`${p(y % 100)}${body}`)) : tlv(0x18, Buffer.from(`${y}${body}`));
}

function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split(".").map(Number));
  const halves = ip.split("::");
  const part = (s: string) => (s ? s.split(":") : []);
  const head = part(halves[0]);
  const tail = halves.length > 1 ? part(halves[1]) : [];
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return Buffer.concat(groups.map((g) => Buffer.from([parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff])));
}

export interface SelfSigned {
  cert: string;
  key: string;
}

/** A self-signed server certificate for these names (the first is the common name). */
export function generateSelfSigned(names: string[], opts: { days?: number; org?: string; now?: Date } = {}): SelfSigned {
  const hosts = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (!hosts.length) hosts.push("localhost");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = opts.now ?? new Date();
  const notBefore = new Date(now.getTime() - 5 * 60_000);
  const notAfter = new Date(now.getTime() + (opts.days ?? 825) * 86400_000);
  const sha256Rsa = seq(oid("1.2.840.113549.1.1.11"), nul());
  const cn = hosts.find((h) => !isIP(h)) ?? hosts[0];
  const name = seq(set(seq(oid("2.5.4.3"), utf8(cn))), set(seq(oid("2.5.4.10"), utf8(opts.org ?? "Self-signed (replace with the organisation's certificate)"))));
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const san = seq(...hosts.map((h) => (isIP(h) ? tlv(0x87, ipBytes(h)) : tlv(0x82, Buffer.from(h, "ascii")))));
  const ski = createHash("sha1").update(spki).digest();
  const extensions = seq(
    seq(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), octets(seq())), // basicConstraints: critical, CA false
    seq(oid("2.5.29.15"), tlv(0x01, Buffer.from([0xff])), octets(tlv(0x03, Buffer.from([0x05, 0xa0])))), // keyUsage: digitalSignature, keyEncipherment
    seq(oid("2.5.29.37"), octets(seq(oid("1.3.6.1.5.5.7.3.1")))), // extKeyUsage: serverAuth
    seq(oid("2.5.29.17"), octets(san)),
    seq(oid("2.5.29.14"), octets(octets(ski))),
  );
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(ctx(0, int(Buffer.from([2]))), int(serial), sha256Rsa, name, seq(time(notBefore), time(notAfter)), name, spki, ctx(3, extensions));
  const signature = createSign("sha256").update(tbs).sign(privateKey);
  const der = seq(tbs, sha256Rsa, bitString(signature));
  const pem = (label: string, b: Buffer) => `-----BEGIN ${label}-----\n${b.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END ${label}-----\n`;
  return { cert: pem("CERTIFICATE", der), key: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

// ----- the server's credentials ----------------------------------------------------------------------------------

export interface CertInfo {
  subject: string;
  issuer: string;
  names: string[];
  valid_from: string;
  valid_to: string;
  days_left: number;
  self_signed: boolean;
  fingerprint256: string;
  source: "pfx" | "pem" | "self-signed";
}

export interface Credentials {
  options: SecureContextOptions;
  info: CertInfo;
}

function infoOf(x: X509Certificate, source: CertInfo["source"]): CertInfo {
  const names = (x.subjectAltName ?? "")
    .split(/,\s*/)
    .map((s) => s.replace(/^(DNS|IP Address):/, "").trim())
    .filter(Boolean);
  const to = new Date(x.validTo);
  return {
    subject: x.subject.replace(/\n/g, ", "),
    issuer: x.issuer.replace(/\n/g, ", "),
    names,
    valid_from: new Date(x.validFrom).toISOString(),
    valid_to: to.toISOString(),
    days_left: Math.floor((to.getTime() - Date.now()) / 86400_000),
    self_signed: x.subject === x.issuer,
    fingerprint256: x.fingerprint256,
    source,
  };
}

/** Check a PFX or PEM pair and describe its certificate; throws a Persian message when it cannot be used. */
export function inspectCredentials(input: { pfx?: Buffer | null; passphrase?: string | null; cert?: string | null; key?: string | null }): Credentials {
  let options: SecureContextOptions;
  let source: CertInfo["source"];
  if (input.pfx) {
    options = { pfx: input.pfx, passphrase: input.passphrase ?? undefined };
    source = "pfx";
  } else if (input.cert && input.key) {
    options = { cert: input.cert, key: input.key };
    source = "pem";
  } else throw new Error("گواهی (فایل .pfx یا جفت PEM گواهی و کلید) داده نشده است");
  let context: ReturnType<typeof createSecureContext>;
  try {
    context = createSecureContext(options);
  } catch (e) {
    const m = String((e as Error).message ?? e);
    if (/mac verify|bad decrypt|password/i.test(m)) throw new Error("گذرواژهٔ فایل گواهی درست نیست");
    if (/key values mismatch/i.test(m)) throw new Error("کلید با گواهی جور نیست");
    throw new Error(`گواهی خوانده نشد: ${m}`);
  }
  let der: Buffer | null = null;
  try {
    der = (context.context as { getCertificate?: () => Buffer | null }).getCertificate?.() ?? null;
  } catch {
    der = null;
  }
  const x = der ? new X509Certificate(der) : input.cert ? new X509Certificate(input.cert) : null;
  if (!x) throw new Error("گواهی خوانده نشد");
  const info = infoOf(x, source);
  if (info.days_left < 0) throw new Error(`گواهی در ${info.valid_to.slice(0, 10)} منقضی شده است`);
  return { options, info };
}

/** Does the certificate name this host (exact or *.wildcard)? */
export function certCovers(info: CertInfo, host: string): boolean {
  const h = host.toLowerCase();
  return info.names.some((n) => {
    const name = n.toLowerCase();
    if (name === h) return true;
    return name.startsWith("*.") && h.endsWith(name.slice(1)) && h.split(".").length === name.split(".").length;
  });
}

/**
 * The server's credentials: the configured certificate, else the self-signed one kept in the tls folder (regenerated
 * when it does not name the public host or has less than 30 days left).
 */
export function loadCredentials(c: ServerEditionConfig): Credentials {
  if (c.tls.pfx || (c.tls.cert && c.tls.key)) {
    const read = (p: string) => readFileSync(p);
    return inspectCredentials({
      pfx: c.tls.pfx ? read(c.tls.pfx) : null,
      passphrase: c.tls.passphrase,
      cert: c.tls.cert ? read(c.tls.cert).toString("utf8") : null,
      key: c.tls.key ? read(c.tls.key).toString("utf8") : null,
    });
  }
  const host = new URL(c.public_url).hostname.toLowerCase();
  const certFile = join(c.dirs.tls, "self-signed.crt");
  const keyFile = join(c.dirs.tls, "self-signed.key");
  if (existsSync(certFile) && existsSync(keyFile)) {
    try {
      const creds = inspectCredentials({ cert: readFileSync(certFile, "utf8"), key: readFileSync(keyFile, "utf8") });
      creds.info.source = "self-signed";
      if (certCovers(creds.info, host) && creds.info.days_left > 30) return creds;
    } catch {
      /* replaced below */
    }
  }
  const names = [host, hostname().toLowerCase(), "localhost", "127.0.0.1"];
  const ss = generateSelfSigned(names);
  mkdirSync(c.dirs.tls, { recursive: true });
  writeFileSync(keyFile, ss.key, { mode: 0o600 });
  writeFileSync(certFile, ss.cert);
  const creds = inspectCredentials(ss);
  creds.info.source = "self-signed";
  return creds;
}

/** TLS 1.2+ with forward-secret AEAD suites on 1.2 (TLS 1.3 suites are all strong). */
export const TLS_CIPHERS = [
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_AES_128_GCM_SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
].join(":");

export function serverTlsOptions(creds: Credentials): SecureContextOptions & { minVersion: "TLSv1.2"; honorCipherOrder: boolean } {
  return { ...creds.options, minVersion: "TLSv1.2", ciphers: TLS_CIPHERS, honorCipherOrder: true };
}
