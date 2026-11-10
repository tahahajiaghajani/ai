// A small LDAP v3 client (catalogue INT-013): simple bind and paged subtree search over ldap:// or ldaps://, enough to
// read people and their groups from Active Directory, OpenLDAP or FreeIPA. BER encoding by hand (RFC 4511, filters per
// RFC 4515, the paged results control 1.2.840.113556.1.4.319) — no dependency. Credentials never leave this module;
// on the web version only public hosts are reached unless the platform allows otherwise (the Windows app reaches the
// office network).
import net from "node:net";
import tls from "node:tls";

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

// ---------------------------------------------------------------- the client

export interface LdapEntry {
  dn: string;
  attrs: Record<string, string[]>;
}

export interface LdapOptions {
  url: string;
  bindDn: string;
  password: string;
  timeoutMs?: number;
  /** test servers: accept a self-signed certificate (never in production) */
  rejectUnauthorized?: boolean;
}

const PAGED = "1.2.840.113556.1.4.319";
const RESULT_NAMES: Record<number, string> = {
  1: "خطای عملیات",
  4: "سقف اندازه",
  10: "ارجاع",
  32: "این ریشهٔ جست‌وجو (Base DN) وجود ندارد",
  49: "نام کاربری یا گذرواژهٔ اتصال نادرست است",
  50: "حساب اتصال اجازهٔ این جست‌وجو را ندارد",
  51: "سرور LDAP مشغول است",
  52: "سرور LDAP در دسترس نیست",
  53: "سرور LDAP درخواست را نپذیرفت",
};

/** One connection: bind, searches, unbind. */
export class LdapClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private waiting = new Map<number, { onMessage: (op: BerNode, controls: BerNode | null) => boolean; resolve: () => void; reject: (e: Error) => void }>();
  private failure: Error | null = null;

  constructor(private o: LdapOptions) {}

  async connect(): Promise<void> {
    const u = new URL(this.o.url);
    const secure = u.protocol === "ldaps:";
    if (!secure && u.protocol !== "ldap:") throw new Error("نشانی LDAP باید با ldap:// یا ldaps:// شروع شود");
    const port = Number(u.port || (secure ? 636 : 389));
    const host = u.hostname;
    const timeout = this.o.timeoutMs ?? 15_000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`سرور LDAP ${host} پاسخ نداد (زمان تمام شد)`)), timeout);
      const onError = (e: Error) => {
        clearTimeout(timer);
        reject(new Error(`اتصال به سرور LDAP ${host} نشد: ${e.message}`));
      };
      const s = secure ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: this.o.rejectUnauthorized !== false }, () => (clearTimeout(timer), resolve())) : net.connect({ host, port }, () => (clearTimeout(timer), resolve()));
      s.once("error", onError);
      s.on("data", (d: Buffer) => this.onData(d));
      s.on("error", (e: Error) => this.fail(new Error(`ارتباط با سرور LDAP قطع شد: ${e.message}`)));
      s.on("close", () => this.fail(new Error("سرور LDAP ارتباط را بست")));
      s.setTimeout(timeout, () => this.fail(new Error("سرور LDAP پاسخ نداد (زمان تمام شد)")));
      this.socket = s;
    });
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
        this.fail(e as Error);
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
    if (!this.socket) return Promise.reject(new Error("به سرور LDAP وصل نیست"));
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
    if (c !== 0) throw new Error(`${RESULT_NAMES[c] ?? `کد ${c}`}${message && strOf(message) ? ` (${strOf(message).slice(0, 200)})` : ""}`);
  }

  async bind(): Promise<void> {
    await this.send(seq(0x60, berInt(3), berStr(this.o.bindDn), berStr(this.o.password, 0x80)), (op) => {
      if (op.tag !== 0x61) throw new Error("پاسخ ورود LDAP شناخته نیست");
      LdapClient.check(op);
      return true;
    });
  }

  /** A subtree search (all pages); at most `max` entries. */
  async search(base: string, filter: string, attributes: string[], opts: { pageSize?: number; max?: number } = {}): Promise<LdapEntry[]> {
    const out: LdapEntry[] = [];
    const max = opts.max ?? 50_000;
    let cookie = Buffer.alloc(0);
    const encoded = encodeFilter(filter);
    for (let page = 0; page < 1000; page++) {
      const control = seq(0xa0, seq(0x30, berStr(PAGED), berBool(false), berStr(seq(0x30, berInt(opts.pageSize ?? 500), berStr(cookie)))));
      const request = seq(0x63, berStr(base), berInt(2, 0x0a), berInt(0, 0x0a), berInt(0), berInt(0), berBool(false), encoded, seq(0x30, ...attributes.map((a) => berStr(a))));
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
