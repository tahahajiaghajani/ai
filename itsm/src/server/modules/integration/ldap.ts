// A small LDAP v3 client (catalogue INT-013): simple bind and paged searches over ldaps:// or ldap:// with StartTLS,
// enough to read people and their groups from Active Directory, OpenLDAP or FreeIPA and to check a person's password
// for «ورود با حساب سازمانی». BER encoding by hand (RFC 4511, filters per RFC 4515, the paged results control
// 1.2.840.113556.1.4.319, StartTLS 1.3.6.1.4.1.1466.20037) — no dependency. Certificates are checked against the
// organisation's own root CA when one is given (the default trust store otherwise) and the server's name; several
// domain controllers are tried in order (connectAny). Values typed by people go into filters only through
// escapeFilterValue. Credentials never leave this module and are never logged; on the web version only public hosts
// are reached unless the platform allows otherwise (the Windows app reaches the office network).
import net from "node:net";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

// ---------------------------------------------------------------- BER

export function berLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export const tlv = (tag: number, value: Buffer) => Buffer.concat([Buffer.from([tag]), berLength(value.length), value]);
export const seq = (tag: number, ...parts: Buffer[]) => tlv(tag, Buffer.concat(parts));

export function berInt(n: number, tag = 0x02): Buffer {
  const bytes: number[] = [];
  let v = n;
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(tag, Buffer.from(bytes));
}

export const berStr = (s: string | Buffer, tag = 0x04) => tlv(tag, Buffer.isBuffer(s) ? s : Buffer.from(s, "utf8"));
export const berBool = (b: boolean) => tlv(0x01, Buffer.from([b ? 0xff : 0x00]));

export interface BerNode {
  tag: number;
  /** the value bytes */
  value: Buffer;
  /** children of a constructed node */
  children: BerNode[];
}

/** Read one TLV at `offset`; null when the buffer does not hold all of it yet. */
export function readTlv(buf: Buffer, offset = 0): { node: BerNode; end: number } | null {
  if (buf.length < offset + 2) return null;
  const tag = buf[offset];
  let len = buf[offset + 1];
  let p = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("طول BER پشتیبانی نمی‌شود");
    if (buf.length < p + n) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i];
    p += n;
  }
  if (buf.length < p + len) return null;
  const value = buf.subarray(p, p + len);
  const children: BerNode[] = [];
  if (tag & 0x20) {
    let q = 0;
    while (q < value.length) {
      const c = readTlv(value, q);
      if (!c) throw new Error("پیام LDAP ناقص است");
      children.push(c.node);
      q = c.end;
    }
  }
  return { node: { tag, value, children }, end: p + len };
}

export const intOf = (n: BerNode) => {
  let v = 0;
  for (const b of n.value) v = v * 256 + b;
  return v;
};
export const strOf = (n: BerNode) => n.value.toString("utf8");

// ---------------------------------------------------------------- filters (RFC 4515)

function unescape(v: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && /^[0-9a-fA-F]{2}$/.test(v.slice(i + 1, i + 3))) {
      bytes.push(parseInt(v.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(v[i], "utf8"));
  }
  return Buffer.from(bytes);
}

/** Encode a filter string («(&(objectClass=user)(mail=*))») as BER. */
export function encodeFilter(filter: string): Buffer {
  let pos = 0;
  const s = filter.trim();
  const expect = (ch: string) => {
    if (s[pos] !== ch) throw new Error(`پالایهٔ LDAP معتبر نیست: «${ch}» در جای ${pos + 1} انتظار می‌رفت`);
    pos++;
  };
  const parse = (): Buffer => {
    expect("(");
    let out: Buffer;
    const c = s[pos];
    if (c === "&" || c === "|") {
      pos++;
      const parts: Buffer[] = [];
      while (s[pos] === "(") parts.push(parse());
      out = seq(c === "&" ? 0xa0 : 0xa1, ...parts);
    } else if (c === "!") {
      pos++;
      out = seq(0xa2, parse());
    } else {
      let depth = 0;
      let end = pos;
      while (end < s.length && !(s[end] === ")" && depth === 0)) {
        if (s[end] === "(") depth++;
        if (s[end] === ")") depth--;
        end++;
      }
      out = item(s.slice(pos, end));
      pos = end;
    }
    expect(")");
    return out;
  };
  const out = parse();
  if (pos !== s.length) throw new Error("پالایهٔ LDAP پس از پایان، متن اضافه دارد");
  return out;
}

function item(text: string): Buffer {
  const ext = /^([^:=]*)(:dn)?(?::([^:=]+))?:=(.*)$/.exec(text);
  if (ext && text.includes(":=")) {
    const parts: Buffer[] = [];
    if (ext[3]) parts.push(berStr(ext[3], 0x81));
    if (ext[1]) parts.push(berStr(ext[1], 0x82));
    parts.push(tlv(0x83, unescape(ext[4])));
    if (ext[2]) parts.push(tlv(0x84, Buffer.from([0xff])));
    return seq(0xa9, ...parts);
  }
  const m = /^([A-Za-z0-9][A-Za-z0-9;.-]*)(~=|>=|<=|=)(.*)$/.exec(text);
  if (!m) throw new Error(`بخش «${text}» پالایهٔ LDAP معتبر نیست`);
  const [, attr, op, value] = m;
  if (op === "=" && value === "*") return berStr(attr, 0x87);
  if (op === "=" && value.includes("*")) {
    const pieces = value.split("*");
    const subs: Buffer[] = [];
    pieces.forEach((p, i) => {
      if (!p) return;
      const tag = i === 0 ? 0x80 : i === pieces.length - 1 ? 0x82 : 0x81;
      subs.push(tlv(tag, unescape(p)));
    });
    return seq(0xa4, berStr(attr), seq(0x30, ...subs));
  }
  const tag = op === "=" ? 0xa3 : op === ">=" ? 0xa5 : op === "<=" ? 0xa6 : 0xa8;
  return seq(tag, berStr(attr), tlv(0x04, unescape(value)));
}

// ---------------------------------------------------------------- escaping (RFC 4515 / RFC 4514)

/**
 * A value for an LDAP filter (RFC 4515 §3): `\ * ( )` and NUL become `\5c \2a \28 \29 \00`, so text a person typed can
 * never change the filter's structure (LDAP injection) — «*)(uid=*» stays one literal value.
 */
export function escapeFilterValue(value: string): string {
  let out = "";
  for (const ch of String(value ?? "")) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "*" || ch === "(" || ch === ")" || c === 0) out += `\\${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out;
}

/** A value inside a DN (RFC 4514 §2.4): `, + " \ < > ; =`, a leading space or `#` and a trailing space are escaped. */
export function escapeDnValue(value: string): string {
  let out = String(value ?? "").replace(/[,+"\\<>;=\u0000]/g, (ch) => (ch === "\u0000" ? "\\00" : `\\${ch}`));
  if (out.startsWith(" ") || out.startsWith("#")) out = `\\${out}`;
  if (out.endsWith(" ") && !out.endsWith("\\ ")) out = `${out.slice(0, -1)}\\ `;
  return out;
}

// ---------------------------------------------------------------- the client

export interface LdapEntry {
  dn: string;
  attrs: Record<string, string[]>;
}

export interface LdapOptions {
  url: string;
  bindDn: string;
  password: string;
  /** connect and answer timeout of one server (default 15 s) */
  timeoutMs?: number;
  /** test servers only: accept any certificate (never in production) */
  rejectUnauthorized?: boolean;
  /** PEM of the certificate authorities that sign the servers' certificates (an organisation's internal root CA) */
  ca?: string | null;
  /** upgrade an ldap:// connection with StartTLS before anything else is sent */
  startTls?: boolean;
  /** refuse a connection that is not encrypted (neither ldaps:// nor StartTLS) */
  requireTls?: boolean;
}

/** Why an LDAP call failed: the network (try another server), TLS, an LDAP result code, or the protocol. */
export type LdapErrorKind = "network" | "tls" | "result" | "protocol" | "input";

export class LdapError extends Error {
  constructor(
    message: string,
    public kind: LdapErrorKind,
    /** the LDAP result code (49 invalidCredentials, 50 insufficientAccessRights…) */
    public code?: number,
    /** Active Directory's sub-code from the diagnostic message («data 52e») */
    public ad?: string | null,
  ) {
    super(message);
  }
}

const PAGED = "1.2.840.113556.1.4.319";
const START_TLS = "1.3.6.1.4.1.1466.20037";
/** LDAP_MATCHING_RULE_IN_CHAIN: transitive group membership in Active Directory */
export const IN_CHAIN = "1.2.840.113556.1.4.1941";

const RESULT_NAMES: Record<number, string> = {
  1: "خطای عملیات",
  2: "خطای پروتکل",
  4: "سقف اندازه",
  8: "سرور LDAP اتصال رمزنگاری‌شده (TLS) یا امضای اتصال می‌خواهد",
  10: "ارجاع",
  13: "سرور LDAP اتصال رمزنگاری‌شده می‌خواهد",
  32: "این ریشهٔ جست‌وجو (Base DN) وجود ندارد",
  34: "نام (DN) معتبر نیست",
  48: "این روش ورود پذیرفته نیست",
  49: "نام کاربری یا گذرواژهٔ اتصال نادرست است",
  50: "حساب اتصال اجازهٔ این جست‌وجو را ندارد",
  51: "سرور LDAP مشغول است",
  52: "سرور LDAP در دسترس نیست",
  53: "سرور LDAP درخواست را نپذیرفت",
};

/** Active Directory's sub-code of a failed bind: «… AcceptSecurityContext error, data 52e, v4563». */
export function adSubCode(diagnostic: string | null | undefined): string | null {
  const m = /\bdata ([0-9a-f]{2,8})\b/i.exec(String(diagnostic ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/** A Persian sentence for a failed TLS handshake (the server's certificate, its name, the port). */
export function tlsProblem(host: string, e: NodeJS.ErrnoException): string {
  const code = String(e.code ?? "");
  if (/ALTNAME|HOSTNAME|ERR_TLS_CERT_ALTNAME_INVALID/.test(code)) return `نام سرور (${host}) با نام‌های گواهی آن هم‌خوان نیست؛ نشانی را با همان نامی بنویسید که در گواهی سرور آمده است`;
  if (/EXPIRED/.test(code)) return `گواهی سرور LDAP (${host}) منقضی شده است`;
  if (/NOT_YET_VALID/.test(code)) return `گواهی سرور LDAP (${host}) هنوز معتبر نشده است (ساعت سرورها را بررسی کنید)`;
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED|CERT_SIGNATURE_FAILURE|CERT_CHAIN/.test(code))
    return `گواهی سرور LDAP (${host}) را مرجع معتبری امضا نکرده است؛ گواهی ریشهٔ سازمان (PEM) را در تنظیمات منبع بارگذاری کنید`;
  if (/WRONG_VERSION|UNKNOWN_PROTOCOL|ECONNRESET|PACKET_LENGTH|HTTP_REQUEST/.test(code) || /wrong version|unknown protocol/i.test(e.message))
    return `سرور ${host} در این درگاه TLS را نمی‌شناسد؛ برای LDAPS درگاه ۶۳۶ و برای StartTLS درگاه ۳۸۹ را به کار ببرید`;
  return `اتصال امن به سرور LDAP ${host} برقرار نشد: ${String(e.message ?? e).slice(0, 200)}`;
}

/** Does `pem` hold at least one parseable certificate? (A problem in Persian, or null.) */
export function caProblem(pem: string | null | undefined): string | null {
  const text = String(pem ?? "").trim();
  if (!text) return null;
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length) return "گواهی ریشه باید با «-----BEGIN CERTIFICATE-----» شروع شود (قالب PEM / Base-64)";
  for (const b of blocks) {
    try {
      new X509Certificate(b);
    } catch {
      return "یکی از گواهی‌های ریشه خوانده نشد؛ نسخهٔ Base-64 (PEM) گواهی را از کنسول گواهی‌های ویندوز بگیرید";
    }
  }
  return null;
}

type Waiter = { onMessage: (op: BerNode, controls: BerNode | null) => boolean; resolve: () => void; reject: (e: Error) => void };

/** One connection: (StartTLS,) binds, searches, unbind. */
export class LdapClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private waiting = new Map<number, Waiter>();
  private failure: Error | null = null;
  /** the server answered over TLS (ldaps:// or after StartTLS) */
  encrypted = false;
  readonly host: string;

  constructor(private o: LdapOptions) {
    let host = "";
    try {
      host = new URL(o.url).hostname.replace(/^\[|\]$/g, "");
    } catch {
      host = "";
    }
    this.host = host;
  }

  private tlsOptions(host: string): tls.ConnectionOptions {
    return {
      host,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: this.o.rejectUnauthorized !== false,
      ...(this.o.ca && String(this.o.ca).trim() ? { ca: String(this.o.ca) } : {}),
      minVersion: "TLSv1.2",
    };
  }

  private attach(s: net.Socket | tls.TLSSocket, timeout: number) {
    s.on("data", (d: Buffer) => this.onData(d));
    s.on("error", (e: Error) => this.fail(new LdapError(`ارتباط با سرور LDAP قطع شد: ${e.message}`, "network")));
    s.on("close", () => this.fail(new LdapError("سرور LDAP ارتباط را بست", "network")));
    s.setTimeout(timeout, () => {
      this.fail(new LdapError(`سرور LDAP ${this.host} پاسخ نداد (زمان تمام شد)`, "network"));
      s.destroy();
    });
    this.socket = s;
  }

  async connect(): Promise<void> {
    let u: URL;
    try {
      u = new URL(this.o.url);
    } catch {
      throw new LdapError("نشانی LDAP معتبر نیست", "input");
    }
    const secure = u.protocol === "ldaps:";
    if (!secure && u.protocol !== "ldap:") throw new LdapError("نشانی LDAP باید با ldap:// یا ldaps:// شروع شود", "input");
    if (!secure && this.o.requireTls && !this.o.startTls) throw new LdapError("اتصال بدون رمزنگاری پذیرفته نیست؛ ldaps:// یا StartTLS را به کار ببرید", "input");
    const port = Number(u.port || (secure ? 636 : 389));
    const host = this.host;
    const timeout = this.o.timeoutMs ?? 15_000;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (e?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (e) {
          s.destroy();
          reject(e);
        } else resolve();
      };
      const timer = setTimeout(() => done(new LdapError(`سرور LDAP ${host} پاسخ نداد (زمان تمام شد)`, "network")), timeout);
      const s = secure ? tls.connect({ ...this.tlsOptions(host), port }, () => done()) : net.connect({ host, port }, () => done());
      s.once("error", (e: NodeJS.ErrnoException) => {
        const isTls = secure && !/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN/.test(String(e.code ?? ""));
        done(isTls ? new LdapError(tlsProblem(host, e), "tls") : new LdapError(`اتصال به سرور LDAP ${host} نشد: ${e.message}`, "network"));
      });
      this.attach(s, timeout);
    });
    this.encrypted = secure;
    if (!secure && this.o.startTls) await this.startTls(host, timeout);
  }

  /** StartTLS (RFC 4511 §4.14): the ExtendedRequest, then the TLS handshake over the same connection. */
  private async startTls(host: string, timeout: number): Promise<void> {
    await this.send(seq(0x77, tlv(0x80, Buffer.from(START_TLS))), (op) => {
      if (op.tag !== 0x78) throw new LdapError("پاسخ StartTLS شناخته نیست", "protocol");
      const [code, , message] = op.children;
      const c = code ? intOf(code) : 0;
      if (c !== 0) throw new LdapError(`سرور LDAP ${host} StartTLS را نپذیرفت${message && strOf(message) ? ` (${strOf(message).slice(0, 200)})` : ""}`, "tls", c);
      return true;
    });
    const plain = this.socket as net.Socket;
    plain.removeAllListeners("data");
    plain.removeAllListeners("error");
    plain.removeAllListeners("close");
    plain.setTimeout(0);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        s.destroy();
        reject(new LdapError(`دست‌دادن TLS با سرور ${host} تمام نشد (زمان تمام شد)`, "tls"));
      }, timeout);
      const s = tls.connect({ ...this.tlsOptions(host), socket: plain }, () => {
        clearTimeout(timer);
        resolve();
      });
      s.once("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        s.destroy();
        reject(new LdapError(tlsProblem(host, e), "tls"));
      });
      this.attach(s, timeout);
    });
    this.encrypted = true;
  }

  private fail(e: Error) {
    this.failure = this.failure ?? e;
    for (const w of this.waiting.values()) w.reject(this.failure);
    this.waiting.clear();
  }

  private onData(d: Buffer) {
    this.buffer = Buffer.concat([this.buffer, d]);
    for (;;) {
      let r: ReturnType<typeof readTlv>;
      try {
        r = readTlv(this.buffer);
      } catch (e) {
        this.fail(new LdapError(String((e as Error).message ?? e), "protocol"));
        return;
      }
      if (!r) return;
      this.buffer = this.buffer.subarray(r.end);
      const [idNode, op, controls] = r.node.children;
      if (!idNode || !op) continue;
      const w = this.waiting.get(intOf(idNode));
      if (!w) continue;
      try {
        if (w.onMessage(op, controls && controls.tag === 0xa0 ? controls : null)) {
          this.waiting.delete(intOf(idNode));
          w.resolve();
        }
      } catch (e) {
        this.waiting.delete(intOf(idNode));
        w.reject(e as Error);
      }
    }
  }

  private send(op: Buffer, onMessage: (op: BerNode, controls: BerNode | null) => boolean, controls?: Buffer): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.socket) return Promise.reject(new LdapError("به سرور LDAP وصل نیست", "network"));
    const id = this.nextId++;
    const msg = seq(0x30, berInt(id), op, ...(controls ? [controls] : []));
    return new Promise<void>((resolve, reject) => {
      this.waiting.set(id, { onMessage, resolve, reject });
      this.socket!.write(msg);
    });
  }

  private static check(result: BerNode): void {
    const [code, , message] = result.children;
    const c = code ? intOf(code) : 0;
    if (c === 0) return;
    const diag = message ? strOf(message) : "";
    throw new LdapError(`${RESULT_NAMES[c] ?? `کد ${c}`}${diag ? ` (${diag.slice(0, 200)})` : ""}`, "result", c, adSubCode(diag));
  }

  /** Simple bind with the connection's own account (the service account). */
  async bind(): Promise<void> {
    await this.bindAs(this.o.bindDn, this.o.password);
  }

  /**
   * Simple bind as `dn` with `password`. An empty password is refused here, before anything is sent: LDAP treats a
   * simple bind with a name and no password as an unauthenticated bind that «succeeds» (RFC 4513 §5.1.2).
   */
  async bindAs(dn: string, password: string): Promise<void> {
    if (!dn || !String(dn).trim()) throw new LdapError("نام حساب برای اتصال خالی است", "input");
    if (typeof password !== "string" || password.length === 0) throw new LdapError("گذرواژه خالی است", "input");
    if (this.o.requireTls && !this.encrypted) throw new LdapError("گذرواژه فقط روی اتصال رمزنگاری‌شده فرستاده می‌شود", "input");
    await this.send(seq(0x60, berInt(3), berStr(dn), berStr(password, 0x80)), (op) => {
      if (op.tag !== 0x61) throw new LdapError("پاسخ ورود LDAP شناخته نیست", "protocol");
      LdapClient.check(op);
      return true;
    });
  }

  /**
   * A search (all pages of a subtree search); at most `max` entries. `scope` 0 reads the base entry only (constructed
   * attributes such as msDS-User-Account-Control-Computed need it), 1 its children, 2 the whole subtree.
   */
  async search(base: string, filter: string, attributes: string[], opts: { pageSize?: number; max?: number; scope?: 0 | 1 | 2 } = {}): Promise<LdapEntry[]> {
    const out: LdapEntry[] = [];
    const max = opts.max ?? 50_000;
    const scope = opts.scope ?? 2;
    let cookie = Buffer.alloc(0);
    const encoded = encodeFilter(filter);
    for (let page = 0; page < 1000; page++) {
      const control = scope === 0 ? undefined : seq(0xa0, seq(0x30, berStr(PAGED), berBool(false), berStr(seq(0x30, berInt(opts.pageSize ?? 500), berStr(cookie)))));
      const request = seq(0x63, berStr(base), berInt(scope, 0x0a), berInt(0, 0x0a), berInt(0), berInt(0), berBool(false), encoded, seq(0x30, ...attributes.map((a) => berStr(a))));
      let next = Buffer.alloc(0);
      await this.send(
        request,
        (op, controls) => {
          if (op.tag === 0x64) {
            const [dn, attrs] = op.children;
            const entry: LdapEntry = { dn: strOf(dn), attrs: {} };
            for (const a of attrs?.children ?? []) {
              const [type, vals] = a.children;
              entry.attrs[strOf(type)] = (vals?.children ?? []).map(strOf);
            }
            if (out.length < max) out.push(entry);
            return false;
          }
          if (op.tag === 0x73) return false;
          if (op.tag === 0x65) {
            LdapClient.check(op);
            for (const ctl of controls?.children ?? []) {
              const [type, ...rest] = ctl.children;
              if (strOf(type) !== PAGED) continue;
              const value = rest.find((x) => x.tag === 0x04);
              if (!value) continue;
              const inner = readTlv(value.value);
              const c = inner?.node.children[1];
              if (c) next = Buffer.from(c.value);
            }
            return true;
          }
          return false;
        },
        control,
      );
      if (!next.length || out.length >= max) break;
      cookie = next;
    }
    return out;
  }

  close(): void {
    try {
      if (this.socket && !this.failure) this.socket.write(seq(0x30, berInt(this.nextId++), tlv(0x42, Buffer.alloc(0))));
    } catch {
      /* closing anyway */
    }
    this.socket?.destroy();
    this.socket = null;
  }
}

/**
 * Connect to the first server of `urls` that answers (domain controllers in order of preference): a server that is
 * down, refuses the connection, times out or fails the TLS handshake is skipped; when none answers, the error lists
 * each one's reason. An LDAP answer (a wrong password…) is never a reason to try the next server.
 */
export async function connectAny(urls: string[], o: Omit<LdapOptions, "url">): Promise<{ client: LdapClient; url: string }> {
  const problems: string[] = [];
  let tlsOnly = true;
  for (const url of urls) {
    const client = new LdapClient({ ...o, url });
    try {
      await client.connect();
      return { client, url };
    } catch (e) {
      client.close();
      if (e instanceof LdapError && e.kind === "input") throw e;
      if (!(e instanceof LdapError && e.kind === "tls")) tlsOnly = false;
      problems.push(String((e as Error).message ?? e));
    }
  }
  if (!problems.length) throw new LdapError("هیچ نشانی‌ای برای سرور LDAP تنظیم نشده است", "input");
  throw new LdapError(problems.length === 1 ? problems[0] : `هیچ‌یک از سرورهای LDAP پاسخ نداد: ${problems.join("؛ ")}`, tlsOnly ? "tls" : "network");
}

/** Bind, search, close. */
export async function ldapSearch(o: LdapOptions, base: string, filter: string, attributes: string[], max?: number): Promise<LdapEntry[]> {
  const c = new LdapClient(o);
  try {
    await c.connect();
    await c.bind();
    return await c.search(base, filter, attributes, { max });
  } finally {
    c.close();
  }
}
