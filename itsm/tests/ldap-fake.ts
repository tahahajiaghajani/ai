// A small in-process LDAP server that behaves like Active Directory where sign-in cares (tests only), built on the
// project's BER helpers: simple binds with AD's sub-codes («data 52e», 533, 775…), the unauthenticated bind an empty
// password makes (it «succeeds», as RFC 4513 says), searches that evaluate the filter they receive (equality, presence,
// substrings, and/or/not, LDAP_MATCHING_RULE_IN_CHAIN over member/memberOf), paged results, StartTLS and LDAPS.
// Every connection, bind and received filter is recorded so tests can prove what reached the «domain controller».
//
// Certificates are made here too (X.509 v3 in DER with the same BER helpers, ECDSA P-256 keys from node:crypto): a
// root CA, server certificates it signs (for 127.0.0.1 / localhost, expired, or for another name) and a foreign CA.
import net from "node:net";
import tls from "node:tls";
import { createPrivateKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { berBool, berInt, berStr, intOf, readTlv, seq, strOf, tlv, IN_CHAIN, type BerNode } from "@server/modules/integration/ldap";

// ---------------------------------------------------------------- certificates

function oid(text: string): Buffer {
  const parts = text.split(".").map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (const n of parts.slice(2)) {
    const chunk: number[] = [];
    let v = n;
    do {
      chunk.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const time = (d: Date) => {
  const iso = d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
};
const name = (cn: string) => seq(0x30, seq(0x31, seq(0x30, oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn, "utf8")))));
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const ECDSA_SHA256 = seq(0x30, oid("1.2.840.10045.4.3.2"));

export interface Cert {
  pem: string;
  key: string;
  keyObject: KeyObject;
  cn: string;
}

let serial = 1000;

/** An X.509 v3 certificate for `cn` signed by `issuer` (self-signed when absent). */
export function makeCert(o: { cn: string; issuer?: Cert; ca?: boolean; dns?: string[]; ips?: string[]; notBefore?: Date; notAfter?: Date }): Cert {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const exts: Buffer[] = [];
  if (o.ca) exts.push(seq(0x30, oid("2.5.29.19"), berBool(true), berStr(seq(0x30, berBool(true)))));
  const alt = [...(o.dns ?? []).map((d) => tlv(0x82, Buffer.from(d))), ...(o.ips ?? []).map((ip) => tlv(0x87, Buffer.from(ip.split(".").map(Number))))];
  if (alt.length) exts.push(seq(0x30, oid("2.5.29.17"), berStr(seq(0x30, ...alt))));
  const notBefore = o.notBefore ?? new Date(Date.now() - 86400_000);
  const notAfter = o.notAfter ?? new Date(Date.now() + 365 * 86400_000);
  const tbs = seq(
    0x30,
    seq(0xa0, berInt(2)),
    berInt(serial++),
    ECDSA_SHA256,
    name(o.issuer?.cn ?? o.cn),
    seq(0x30, time(notBefore), time(notAfter)),
    name(o.cn),
    spki,
    ...(exts.length ? [seq(0xa3, seq(0x30, ...exts))] : []),
  );
  const signer = o.issuer?.keyObject ?? privateKey;
  const der = seq(0x30, tbs, ECDSA_SHA256, bitString(sign("sha256", tbs, signer)));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").replace(/(.{64})/g, "$1\n").trim()}\n-----END CERTIFICATE-----\n`;
  const key = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { pem, key, keyObject: createPrivateKey(key), cn: o.cn };
}

/** A root CA, a server certificate for 127.0.0.1/localhost it signs, an expired one, one for another name, a foreign CA. */
export function testPki() {
  const ca = makeCert({ cn: "Test Bank Root CA", ca: true });
  const server = makeCert({ cn: "dc1.corp.test", issuer: ca, dns: ["localhost", "dc1.corp.test"], ips: ["127.0.0.1"] });
  const expired = makeCert({ cn: "dc1.corp.test", issuer: ca, dns: ["localhost"], ips: ["127.0.0.1"], notBefore: new Date(Date.now() - 20 * 86400_000), notAfter: new Date(Date.now() - 10 * 86400_000) });
  const wrongName = makeCert({ cn: "dc9.elsewhere.test", issuer: ca, dns: ["dc9.elsewhere.test"] });
  const foreignCa = makeCert({ cn: "Someone Else CA", ca: true });
  const foreign = makeCert({ cn: "dc1.corp.test", issuer: foreignCa, dns: ["localhost"], ips: ["127.0.0.1"] });
  return { ca, server, expired, wrongName, foreignCa, foreign };
}

// ---------------------------------------------------------------- the directory

export interface FakeEntry {
  dn: string;
  attrs: Record<string, string[]>;
  /** the password a simple bind needs (none: binds fail) */
  password?: string;
  /** Active Directory's sub-code for a bind with the right password (533 disabled, 701 expired, 532, 773…) */
  bindCode?: string;
  /** a sub-code AD returns whatever the password (775 locked) */
  alwaysCode?: string;
}

export interface FakeOptions {
  /** "plain" (ldap://, StartTLS allowed), "ldaps" (TLS from the first byte) */
  mode?: "plain" | "ldaps";
  cert?: Cert;
  /** refuse simple binds and searches before StartTLS (AD's «strong auth required») */
  requireTls?: boolean;
  /** entries a page (paged results) */
  pageSize?: number;
  /** bytes sent in clear text right behind the StartTLS answer (an attacker on the path) */
  afterStartTls?: Buffer;
}

export interface FakeLdap {
  url: string;
  port: number;
  entries: FakeEntry[];
  /** connections accepted */
  connections: number;
  /** names bound with (and whether the password was empty) */
  binds: { dn: string; empty: boolean; ok: boolean }[];
  /** filters received, decoded back to RFC 4515 text */
  filters: string[];
  starttls: number;
  close(): Promise<void>;
  reset(): void;
}

const lower = (s: string) => s.trim().toLowerCase();
const normDn = (dn: string) => lower(dn).replace(/\s*,\s*/g, ",");

function attrOf(e: FakeEntry, name: string): string[] {
  if (lower(name) === "distinguishedname" || lower(name) === "dn") return [e.dn];
  const k = Object.keys(e.attrs).find((x) => lower(x) === lower(name));
  return k ? e.attrs[k] : [];
}

/** Decode a BER filter back to text (values escaped per RFC 4515) — what the test asserts the client sent. */
export function filterText(n: BerNode): string {
  const esc = (b: Buffer) => {
    let out = "";
    for (const byte of b) {
      const ch = String.fromCharCode(byte);
      out += byte < 0x20 || byte > 0x7e || "\\*()".includes(ch) ? `\\${byte.toString(16).padStart(2, "0")}` : ch;
    }
    return out;
  };
  switch (n.tag) {
    case 0xa0:
      return `(&${n.children.map(filterText).join("")})`;
    case 0xa1:
      return `(|${n.children.map(filterText).join("")})`;
    case 0xa2:
      return `(!${filterText(n.children[0])})`;
    case 0xa3:
      return `(${strOf(n.children[0])}=${esc(n.children[1].value)})`;
    case 0x87:
      return `(${n.value.toString("utf8")}=*)`;
    case 0xa4: {
      const subs = n.children[1].children;
      let s = !subs.length || subs[0].tag !== 0x80 ? "*" : "";
      for (const x of subs) s += x.tag === 0x82 ? esc(x.value) : `${esc(x.value)}*`;
      return `(${strOf(n.children[0])}=${s})`;
    }
    case 0xa9: {
      const rule = n.children.find((x) => x.tag === 0x81);
      const type = n.children.find((x) => x.tag === 0x82);
      const value = n.children.find((x) => x.tag === 0x83);
      return `(${type ? type.value.toString("utf8") : ""}${rule ? `:${rule.value.toString("utf8")}` : ""}:=${value ? esc(value.value) : ""})`;
    }
    default:
      return `(?${n.tag.toString(16)})`;
  }
}

function makeMatcher(entries: () => FakeEntry[]) {
  const byDn = () => new Map(entries().map((e) => [normDn(e.dn), e]));
  /** every group a DN belongs to, directly or through other groups */
  const chainOf = (dn: string): Set<string> => {
    const map = byDn();
    const out = new Set<string>();
    const queue = [normDn(dn)];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const g of map.values()) {
        if (out.has(normDn(g.dn))) continue;
        if (attrOf(g, "member").some((m) => normDn(m) === cur)) {
          out.add(normDn(g.dn));
          queue.push(normDn(g.dn));
        }
      }
    }
    return out;
  };
  const match = (e: FakeEntry, f: BerNode): boolean => {
    switch (f.tag) {
      case 0xa0:
        return f.children.every((c) => match(e, c));
      case 0xa1:
        return f.children.some((c) => match(e, c));
      case 0xa2:
        return !match(e, f.children[0]);
      case 0x87:
        return attrOf(e, f.value.toString("utf8")).length > 0;
      case 0xa3: {
        const want = lower(f.children[1].value.toString("utf8"));
        const attr = strOf(f.children[0]);
        // objectCategory=person: AD expands the short name to the class's DN
        if (lower(attr) === "objectcategory") return attrOf(e, attr).some((v) => lower(v) === want || lower(v).startsWith(`cn=${want},`));
        return attrOf(e, attr).some((v) => (lower(attr) === "member" || lower(attr) === "memberof" || lower(attr) === "manager" ? normDn(v) === normDn(want) : lower(v) === want));
      }
      case 0xa4: {
        const attr = strOf(f.children[0]);
        return attrOf(e, attr).some((raw) => {
          const v = lower(raw);
          let pos = 0;
          for (const x of f.children[1].children) {
            const part = lower(x.value.toString("utf8"));
            if (x.tag === 0x80) {
              if (!v.startsWith(part)) return false;
              pos = part.length;
            } else if (x.tag === 0x82) {
              if (!v.slice(pos).endsWith(part)) return false;
            } else {
              const at = v.indexOf(part, pos);
              if (at < 0) return false;
              pos = at + part.length;
            }
          }
          return true;
        });
      }
      case 0xa9: {
        const rule = f.children.find((x) => x.tag === 0x81)?.value.toString("utf8");
        const type = lower(f.children.find((x) => x.tag === 0x82)?.value.toString("utf8") ?? "");
        const value = f.children.find((x) => x.tag === 0x83)?.value.toString("utf8") ?? "";
        if (rule !== IN_CHAIN) return false;
        // group: (member:IN_CHAIN:=<user dn>) — the user is a member of this group, directly or not
        if (type === "member") return chainOf(value).has(normDn(e.dn));
        // user: (memberOf:IN_CHAIN:=<group dn>)
        if (type === "memberof") return chainOf(e.dn).has(normDn(value));
        return false;
      }
      default:
        return false;
    }
  };
  return { match, byDn };
}

const PAGED = "1.2.840.113556.1.4.319";
const START_TLS = "1.3.6.1.4.1.1466.20037";
const diag = (code: string) => `80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${code}, v4563`;

/** Start a fake domain controller on 127.0.0.1 (a random port). */
export async function fakeLdap(initial: FakeEntry[], o: FakeOptions = {}): Promise<FakeLdap> {
  const state: FakeLdap = {
    url: "",
    port: 0,
    entries: initial,
    connections: 0,
    binds: [],
    filters: [],
    starttls: 0,
    close: async () => undefined,
    reset() {
      state.connections = 0;
      state.binds = [];
      state.filters = [];
      state.starttls = 0;
    },
  };
  const { match, byDn } = makeMatcher(() => state.entries);
  const sockets = new Set<net.Socket>();

  const serve = (raw: net.Socket, encryptedFromStart: boolean) => {
    let sock: net.Socket = raw;
    let encrypted = encryptedFromStart;
    let bound: string | null = null;
    let buf = Buffer.alloc(0);
    const write = (b: Buffer) => sock.write(b);
    const result = (id: number, tag: number, code: number, message = "") => write(seq(0x30, berInt(id), seq(tag, berInt(code, 0x0a), berStr(""), berStr(message))));
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        let r: ReturnType<typeof readTlv>;
        try {
          r = readTlv(buf);
        } catch {
          sock.destroy();
          return;
        }
        if (!r) return;
        buf = buf.subarray(r.end);
        const [idNode, op, controls] = r.node.children;
        if (r.node.tag !== 0x30 || !idNode || !op) {
          // not LDAP (a TLS hello sent to the plain port…)
          sock.destroy();
          return;
        }
        const id = intOf(idNode);
        if (op.tag === 0x77) {
          const nameNode = op.children.find((x) => x.tag === 0x80);
          if (nameNode?.value.toString("utf8") !== START_TLS || !o.cert || encrypted) {
            write(seq(0x30, berInt(id), seq(0x78, berInt(2, 0x0a), berStr(""), berStr("unsupported extended operation"))));
            continue;
          }
          write(Buffer.concat([seq(0x30, berInt(id), seq(0x78, berInt(0, 0x0a), berStr(""), berStr(""))), o.afterStartTls ?? Buffer.alloc(0)]));
          state.starttls++;
          sock.removeListener("data", onData);
          const secure = new tls.TLSSocket(sock, { isServer: true, key: o.cert.key, cert: o.cert.pem });
          secure.on("error", () => secure.destroy());
          secure.on("data", onData);
          sock = secure;
          encrypted = true;
          continue;
        }
        if (op.tag === 0x60) {
          const [, nameN, auth] = op.children;
          const dn = strOf(nameN);
          const pw = auth.value.toString("utf8");
          if (o.requireTls && !encrypted) {
            state.binds.push({ dn, empty: !pw, ok: false });
            result(id, 0x61, 8, "00002028: LdapErr: DSID-0C090259, comment: The server requires binds to turn on integrity checking if SSL\\TLS are not already active on the connection");
            continue;
          }
          if (!pw) {
            // RFC 4513 §5.1.2: a name without a password is an unauthenticated bind — and it «succeeds»
            state.binds.push({ dn, empty: true, ok: true });
            bound = null;
            result(id, 0x61, 0);
            continue;
          }
          const e = byDn().get(normDn(dn));
          if (!e || e.password === undefined) {
            state.binds.push({ dn, empty: false, ok: false });
            result(id, 0x61, 49, diag("52e"));
            continue;
          }
          if (e.alwaysCode) {
            state.binds.push({ dn, empty: false, ok: false });
            result(id, 0x61, 49, diag(e.alwaysCode));
            continue;
          }
          if (pw !== e.password) {
            state.binds.push({ dn, empty: false, ok: false });
            result(id, 0x61, 49, diag("52e"));
            continue;
          }
          if (e.bindCode) {
            state.binds.push({ dn, empty: false, ok: false });
            result(id, 0x61, 49, diag(e.bindCode));
            continue;
          }
          state.binds.push({ dn, empty: false, ok: true });
          bound = e.dn;
          result(id, 0x61, 0);
          continue;
        }
        if (op.tag === 0x63) {
          const [baseN, scopeN, , , , , filterN, attrsN] = op.children;
          state.filters.push(filterText(filterN));
          if (!bound) {
            result(id, 0x65, 1, "000004DC: LdapErr: DSID-0C090A5C, comment: In order to perform this operation a successful bind must be completed on the connection., data 0, v4563");
            continue;
          }
          const base = normDn(strOf(baseN));
          const scope = intOf(scopeN);
          const wanted = (attrsN?.children ?? []).map((a) => lower(strOf(a)));
          let cookie = "";
          let size = o.pageSize ?? 1000;
          for (const ctl of (controls as BerNode | undefined)?.children ?? []) {
            const [type, ...rest] = ctl.children;
            if (strOf(type) !== PAGED) continue;
            const value = rest.find((x) => x.tag === 0x04);
            if (!value) continue;
            const inner = readTlv(value.value)!.node;
            size = Math.min(size, intOf(inner.children[0]) || size);
            cookie = strOf(inner.children[1]);
          }
          const all = state.entries.filter((e) => {
            const dn = normDn(e.dn);
            const inScope = scope === 0 ? dn === base : dn === base || dn.endsWith(`,${base}`);
            return inScope && match(e, filterN);
          });
          const start = cookie ? Number(cookie) : 0;
          const page = all.slice(start, start + size);
          for (const p of page) {
            const attrs = Object.entries(p.attrs)
              .filter(([k]) => !wanted.length || wanted.includes(lower(k)))
              .map(([k, vals]) => seq(0x30, berStr(k), seq(0x31, ...vals.map((v) => berStr(lower(k) === "objectguid" ? guidBytes(v) : v)))));
            write(seq(0x30, berInt(id), seq(0x64, berStr(p.dn), seq(0x30, ...attrs))));
          }
          const next = start + size < all.length ? String(start + size) : "";
          write(seq(0x30, berInt(id), seq(0x65, berInt(0, 0x0a), berStr(""), berStr("")), seq(0xa0, seq(0x30, berStr(PAGED), berStr(seq(0x30, berInt(0), berStr(next)))))));
          continue;
        }
        if (op.tag === 0x42) {
          sock.end();
          return;
        }
      }
    };
    sock.on("data", onData);
    sock.on("error", () => sock.destroy());
  };

  const server =
    o.mode === "ldaps"
      ? tls.createServer({ key: o.cert!.key, cert: o.cert!.pem }, (s) => serve(s, true))
      : net.createServer((s) => serve(s, false));
  server.on("connection", (s: net.Socket) => {
    state.connections++;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  state.port = (server.address() as net.AddressInfo).port;
  state.url = `${o.mode === "ldaps" ? "ldaps" : "ldap"}://127.0.0.1:${state.port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    });
  return state;
}

/** A port nobody listens on (a domain controller that is down). */
export async function deadPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

// ---------------------------------------------------------------- an Active Directory of a bank

export const BASE = "DC=corp,DC=test";
export const SVC = { dn: `CN=svc-kariz,OU=Service Accounts,${BASE}`, password: "Svc-Pass-1!" };
const FILETIME_EPOCH = 11644473600000;
/** A Windows FILETIME (100 ns since 1601) for a JavaScript time. */
export const filetime = (ms: number) => String(BigInt(ms + FILETIME_EPOCH) * 10000n);
export const NEVER = "9223372036854775807";

/** AD's objectGUID bytes of a GUID's text form (the first three groups little-endian). */
export function guidBytes(guid: string): Buffer {
  const b = Buffer.from(guid.replace(/-/g, ""), "hex");
  return Buffer.concat([Buffer.from(b.subarray(0, 4)).reverse(), Buffer.from(b.subarray(4, 6)).reverse(), Buffer.from(b.subarray(6, 8)).reverse(), b.subarray(8)]);
}

/** LDAP GeneralizedTime of a moment («20261110083000.0Z»). */
export const generalized = (d = new Date()) => `${d.toISOString().replace(/[-:T]/g, "").slice(0, 14)}.0Z`;

export function person(sam: string, o: { name?: string; mail?: string | null; upn?: string; uac?: number; password?: string; groups?: string[]; extra?: Record<string, string[]>; bindCode?: string; alwaysCode?: string; ou?: string } = {}): FakeEntry {
  const dn = `CN=${o.name ?? sam},OU=${o.ou ?? "Staff"},${BASE}`;
  return {
    dn,
    password: o.password ?? "Passw0rd!",
    bindCode: o.bindCode,
    alwaysCode: o.alwaysCode,
    attrs: {
      objectClass: ["top", "person", "organizationalPerson", "user"],
      objectCategory: [`CN=Person,CN=Schema,CN=Configuration,${BASE}`],
      sAMAccountName: [sam],
      userPrincipalName: [o.upn ?? `${sam}@corp.test`],
      displayName: [o.name ?? sam],
      cn: [o.name ?? sam],
      ...(o.mail === null ? {} : { mail: [o.mail ?? `${sam}@corp.test`] }),
      userAccountControl: [String(o.uac ?? 512)],
      // every directory object has its own identity, whatever its DN
      objectGUID: [randomUUID()],
      whenCreated: [generalized(new Date(Date.now() - 365 * 86400_000))],
      pwdLastSet: [filetime(Date.now() - 86400_000)],
      accountExpires: [NEVER],
      "msDS-UserPasswordExpiryTimeComputed": [filetime(Date.now() + 30 * 86400_000)],
      "msDS-User-Account-Control-Computed": ["0"],
      ...(o.groups?.length ? { memberOf: o.groups } : {}),
      ...(o.extra ?? {}),
    },
  };
}

export function group(cn: string, members: string[], ou = "Groups"): FakeEntry {
  return { dn: `CN=${cn},OU=${ou},${BASE}`, attrs: { objectClass: ["top", "group"], cn: [cn], member: members } };
}

export function serviceAccount(): FakeEntry {
  return { dn: SVC.dn, password: SVC.password, attrs: { objectClass: ["top", "person", "user"], sAMAccountName: ["svc-kariz"], userAccountControl: ["66048"] } };
}
