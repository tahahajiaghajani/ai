// A small transaction pooler in front of a real PostgreSQL that hands backends back the way Supavisor v2.9.13 does
// (Node built-ins only), for tests/web-db-pooler-pg.test.ts. Ported from the 1.1.4 evidence emulator (its
// 'transaction' mode), with two test devices added.
//
// - The pooler answers the client's startup itself (AuthenticationOk, the backends' ParameterStatus set, its own
//   BackendKeyData, ReadyForQuery 'I'), ignores the client's startup parameters, and logs its backends in with trust,
//   cleartext, md5 or SCRAM-SHA-256 (application_name 'Supavisor'). No TLS (it answers 'N' to SSLRequest).
// - Backends are pooled (poolboy, last in first out, at most `poolSize`): a client without one checks one out when it
//   writes. While a client holds a backend, every chunk read from the backend is forwarded to it, and when a chunk ENDS
//   with ReadyForQuery 'I' the backend goes back to the pool at once (Supavisor v2.9.13 db_handler.ex 411-426) — even
//   when the client has already sent its next statement, whose answer then arrives while the backend sits in the pool
//   and is dropped (db_handler.ex 395-402), or goes to the next client of that backend.
// - A client chunk that starts with Sync while it holds no backend is answered ReadyForQuery 'I' by the pooler and the
//   rest of the chunk is dropped (client_handler.ex 677-694).
// - A CancelRequest is sent to the backend the client holds at that moment (none: nothing happens).
// - A model of each backend's queue of requests attributes every backend message to the client whose request it
//   answers: `stats` counts backends released while still owing answers (releasedOwing), answers dropped while the
//   backend sat in the pool (droppedMsgs) and answers delivered to another client (misdeliveredMsgs).
// Test devices: `blackhole(re)` drops, forever, every answer to the client whose next Parse or Query text matches `re`
// (an answer lost on the way); `freezeAll()` stops forwarding anything on the sockets open now without closing them
// (the dead sockets of a paused serverless instance).
import net from "node:net";
import crypto from "node:crypto";

const RFQ_I = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
const EXTENDED = new Set(["P", "B", "D", "E", "C"]);

function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const b = Buffer.alloc(5 + body.length);
  b[0] = type.charCodeAt(0);
  b.writeInt32BE(4 + body.length, 1);
  body.copy(b, 5);
  return b;
}
const cstr = (s: string) => Buffer.from(`${s}\0`, "utf8");
const parameterStatus = (k: string, v: string) => message("S", Buffer.concat([cstr(k), cstr(v)]));
const readyForQuery = (status: string) => message("Z", Buffer.from(status));
const errorResponse = (code: string, text: string) => message("E", Buffer.concat([cstr("SFATAL"), cstr("VFATAL"), cstr(`C${code}`), cstr(`M${text}`), Buffer.from([0])]));

interface Msg {
  type: string;
  body: Buffer;
}

/** Splits a byte stream into typed protocol messages (1-byte type + int32 length), across chunk boundaries. */
class Framer {
  buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): Msg[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Msg[] = [];
    let i = 0;
    while (this.buf.length - i >= 5) {
      const len = this.buf.readInt32BE(i + 1);
      if (this.buf.length - i < 1 + len) break;
      out.push({ type: String.fromCharCode(this.buf[i]), body: this.buf.subarray(i + 5, i + 1 + len) });
      i += 1 + len;
    }
    this.buf = i ? Buffer.from(this.buf.subarray(i)) : this.buf;
    return out;
  }
  get partial(): boolean {
    return this.buf.length > 0;
  }
}

/** The text of a Parse (name\0text\0…) or a Query (text\0) message. */
function statementText(m: Msg): string | null {
  if (m.type === "Q") return m.body.toString("utf8").replace(/\0$/, "");
  if (m.type !== "P") return null;
  const a = m.body.indexOf(0);
  const b = m.body.indexOf(0, a + 1);
  return a < 0 || b < 0 ? null : m.body.subarray(a + 1, b).toString("utf8");
}

/** A backend's queue of requests still to answer: each backend message is matched against its head. */
class RequestModel {
  q: { t: string; owner: number }[] = [];
  unsynced = false;
  ignoreTillSync = false;
  rfq = "I";
  cf = new Framer();
  bf = new Framer();
  client(chunk: Buffer, owner: number): Msg[] {
    const msgs = this.cf.push(chunk);
    for (const m of msgs) {
      const t = m.type;
      if (t === "S") {
        this.q.push({ t, owner });
        this.unsynced = false;
        this.ignoreTillSync = false;
      } else if (this.ignoreTillSync) {
        // skipped by the backend until Sync: no answer
      } else if (EXTENDED.has(t)) {
        this.q.push({ t, owner });
        this.unsynced = true;
      } else if (t === "Q" || t === "F") this.q.push({ t, owner });
    }
    return msgs;
  }
  backend(chunk: Buffer): { type: string; owner: number | null }[] {
    const out: { type: string; owner: number | null }[] = [];
    for (const m of this.bf.push(chunk)) {
      const t = m.type;
      const h = this.q[0];
      const owner = h ? h.owner : null;
      if (t === "1" && h?.t === "P") this.q.shift();
      else if (t === "2" && h?.t === "B") this.q.shift();
      else if (t === "3" && h?.t === "C") this.q.shift();
      else if ((t === "T" || t === "n") && h?.t === "D") this.q.shift();
      else if ((t === "C" || t === "I" || t === "s") && h?.t === "E") this.q.shift();
      else if (t === "E" && h && EXTENDED.has(h.t)) {
        while (this.q.length && this.q[0].t !== "S") this.q.shift();
        if (!this.q.length) this.ignoreTillSync = true;
      } else if (t === "Z") {
        if (h && (h.t === "S" || h.t === "Q" || h.t === "F")) this.q.shift();
        this.rfq = String.fromCharCode(m.body[0]);
      }
      out.push({ type: t, owner });
    }
    return out;
  }
  get owing(): boolean {
    return this.q.length > 0 || this.unsynced || this.ignoreTillSync || this.cf.partial;
  }
}

export interface BackendTarget {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

/** Logs in to PostgreSQL; resolves after its ReadyForQuery. */
function login(target: BackendTarget, timeoutMs = 15_000): Promise<{ sock: net.Socket; params: Map<string, string>; pid: number; secret: number; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    const { host, port, user, database } = target;
    const password = target.password ?? "";
    const sock = net.connect({ host, port });
    sock.setNoDelay(true);
    const framer = new Framer();
    const params = new Map<string, string>();
    let pid = 0;
    let secret = 0;
    let scram: { nonce: string; bare: string; expect?: string } | null = null;
    const fail = (e: Error) => {
      clearTimeout(timer);
      sock.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error("backend connect timeout")), timeoutMs);
    sock.once("error", fail);
    sock.on("connect", () => {
      const parts = [Buffer.alloc(8), cstr("user"), cstr(user), cstr("database"), cstr(database), cstr("application_name"), cstr("Supavisor"), Buffer.from([0])];
      const b = Buffer.concat(parts);
      b.writeInt32BE(b.length, 0);
      b.writeInt32BE(196608, 4);
      sock.write(b);
    });
    const hmac = (key: Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
    const md5 = (x: string | Buffer) => crypto.createHash("md5").update(x).digest("hex");
    const onData = (chunk: Buffer) => {
      for (const m of framer.push(chunk)) {
        if (m.type === "R") {
          const code = m.body.readInt32BE(0);
          if (code === 0) continue;
          if (code === 3) sock.write(message("p", cstr(password)));
          else if (code === 5) sock.write(message("p", cstr(`md5${md5(Buffer.concat([Buffer.from(md5(password + user)), m.body.subarray(4, 8)]))}`)));
          else if (code === 10) {
            const nonce = crypto.randomBytes(18).toString("base64");
            scram = { nonce, bare: `n=*,r=${nonce}` };
            const first = Buffer.from(`n,,${scram.bare}`);
            const len = Buffer.alloc(4);
            len.writeInt32BE(first.length);
            sock.write(message("p", Buffer.concat([cstr("SCRAM-SHA-256"), len, first])));
          } else if (code === 11 && scram) {
            const serverFirst = m.body.subarray(4).toString("utf8");
            const f = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
            const salted = crypto.pbkdf2Sync(password, Buffer.from(f.s, "base64"), Number(f.i), 32, "sha256");
            const clientKey = hmac(salted, "Client Key");
            const withoutProof = `c=biws,r=${f.r}`;
            const auth = `${scram.bare},${serverFirst},${withoutProof}`;
            const sig = hmac(crypto.createHash("sha256").update(clientKey).digest(), auth);
            const proof = Buffer.from(clientKey.map((x, i) => x ^ sig[i]));
            scram.expect = hmac(hmac(salted, "Server Key"), auth).toString("base64");
            sock.write(message("p", Buffer.from(`${withoutProof},p=${proof.toString("base64")}`)));
          } else if (code === 12) {
            if (m.body.subarray(4).toString("utf8").replace(/^v=/, "") !== scram?.expect) return fail(new Error("SCRAM server signature mismatch"));
          } else return fail(new Error(`unsupported authentication request ${code}`));
        } else if (m.type === "S") {
          const [k, v] = m.body.toString("utf8").split("\0");
          params.set(k, v);
        } else if (m.type === "K") {
          pid = m.body.readInt32BE(0);
          secret = m.body.readInt32BE(4);
        } else if (m.type === "E") return fail(new Error(`backend login failed: ${m.body.toString("utf8").replace(/\0/g, " ").trim()}`));
        else if (m.type === "Z") {
          clearTimeout(timer);
          sock.off("data", onData);
          sock.off("error", fail);
          sock.pause();
          return resolve({ sock, params, pid, secret, rest: framer.buf });
        }
      }
    };
    sock.on("data", onData);
  });
}

export interface PoolerStats {
  clients: number;
  checkouts: number;
  releases: number;
  releasedOwing: number;
  droppedMsgs: number;
  misdeliveredMsgs: number;
  blackholedMsgs: number;
  frozenChunks: number;
  backendsOpened: number;
}

class Backend {
  sock!: net.Socket;
  pid = 0;
  secret = 0;
  params = new Map<string, string>();
  client: Client | null = null;
  model = new RequestModel();
  closed = false;
  constructor(private pooler: Pooler) {}
  async connect(): Promise<void> {
    const r = await login(this.pooler.target);
    Object.assign(this, { sock: r.sock, params: r.params, pid: r.pid, secret: r.secret });
    this.sock.on("data", (chunk: Buffer) => this.onData(chunk));
    this.sock.on("error", () => {});
    this.sock.on("close", () => this.gone());
    this.sock.resume();
    if (r.rest.length) this.onData(r.rest);
    this.pooler.stats.backendsOpened++;
  }
  write(chunk: Buffer, from: Client): void {
    const msgs = this.model.client(chunk, from.id);
    const hole = this.pooler.hole;
    if (hole && msgs.some((m) => hole.test(statementText(m) ?? ""))) {
      this.pooler.hole = null;
      from.blackholed = true;
    }
    this.sock.write(chunk);
  }
  onData(chunk: Buffer): void {
    const p = this.pooler;
    const msgs = this.model.backend(chunk);
    const c = this.client;
    for (const m of msgs) {
      if (!c) p.stats.droppedMsgs++;
      else if (m.owner !== null && m.owner !== c.id) p.stats.misdeliveredMsgs++;
    }
    if (!c) return;
    if (c.blackholed) p.stats.blackholedMsgs += msgs.length;
    else if (c.frozen) p.stats.frozenChunks++;
    else c.write(chunk);
    // Supavisor v2.9.13: a chunk that ends with ReadyForQuery 'I' gives the backend back to the pool at once
    if (chunk.length >= 6 && chunk.subarray(chunk.length - 6).equals(RFQ_I)) this.release();
  }
  release(): void {
    const c = this.client;
    this.client = null;
    this.pooler.stats.releases++;
    if (this.model.owing) this.pooler.stats.releasedOwing++;
    if (c && c.backend === this) {
      c.backend = null;
      if (c.state === "busy") c.state = "idle";
    }
    if (!this.closed) this.pooler.checkin(this);
  }
  destroy(): void {
    if (this.closed) return;
    this.sock?.destroy();
    this.gone();
  }
  gone(): void {
    if (this.closed) return;
    this.closed = true;
    const p = this.pooler;
    p.all.delete(this);
    const i = p.idle.indexOf(this);
    if (i >= 0) p.idle.splice(i, 1);
    const c = this.client;
    this.client = null;
    if (c && c.backend === this) {
      c.backend = null;
      c.fatal("server connection closed");
    }
  }
}

class Client {
  id: number;
  backend: Backend | null = null;
  state: "startup" | "idle" | "checkout" | "busy" | "closed" = "startup";
  pending: Buffer[] = [];
  sbuf: Buffer = Buffer.alloc(0);
  fakePid: number;
  fakeSecret: number;
  blackholed = false;
  frozen = false;
  constructor(
    private pooler: Pooler,
    public sock: net.Socket,
  ) {
    this.id = ++pooler.ids;
    this.fakePid = 100_000 + this.id;
    this.fakeSecret = crypto.randomBytes(4).readInt32BE(0);
    sock.setNoDelay(true);
    sock.on("data", (chunk: Buffer) => this.onData(chunk));
    sock.on("error", () => {});
    sock.on("close", () => this.onClose());
  }
  write(chunk: Buffer): void {
    if (this.state !== "closed" && !this.sock.destroyed) this.sock.write(chunk);
  }
  fatal(text: string): void {
    this.write(errorResponse("08006", text));
    setTimeout(() => this.sock.destroy(), 5);
  }
  onData(chunk: Buffer): void {
    if (this.state === "closed") return;
    if (this.state === "startup") return this.onStartup(chunk);
    if (this.frozen) {
      this.pooler.stats.frozenChunks++;
      return;
    }
    // Terminate (client_handler.ex 671)
    if (chunk.length === 5 && chunk[0] === 0x58) return void this.sock.destroy();
    if (this.backend) return this.backend.write(chunk, this);
    if (this.state === "checkout") return void this.pending.push(chunk);
    // no backend attached: a chunk starting with Sync is answered by the pooler, the rest of it dropped
    if (chunk[0] === 0x53 && chunk.length >= 5 && chunk.readInt32BE(1) === 4) return this.write(readyForQuery("I"));
    this.state = "checkout";
    this.pending.push(chunk);
    this.pooler.checkout().then(
      (b) => {
        if (this.state === "closed") return this.pooler.checkin(b);
        b.client = this;
        this.backend = b;
        this.state = "busy";
        for (const c of this.pending.splice(0)) b.write(c, this);
      },
      (e: Error) => this.fatal(e.message),
    );
  }
  onStartup(chunk: Buffer): void {
    const p = this.pooler;
    this.sbuf = Buffer.concat([this.sbuf, chunk]);
    while (this.sbuf.length >= 8) {
      const len = this.sbuf.readInt32BE(0);
      if (this.sbuf.length < len) return;
      const code = this.sbuf.readInt32BE(4);
      const body = this.sbuf.subarray(8, len);
      this.sbuf = Buffer.from(this.sbuf.subarray(len));
      if (code === 80877103 || code === 80877104) {
        this.write(Buffer.from("N"));
        continue;
      }
      if (code === 80877102) {
        p.cancel(body.readInt32BE(0), body.readInt32BE(4));
        return void this.sock.destroy();
      }
      if (code !== 196608) return this.fatal(`unsupported startup code ${code}`);
      p.stats.clients++;
      const key = Buffer.alloc(8);
      key.writeInt32BE(this.fakePid, 0);
      key.writeInt32BE(this.fakeSecret, 4);
      const greeting = [message("R", Buffer.from([0, 0, 0, 0]))];
      for (const [k, v] of p.parameters) greeting.push(parameterStatus(k, v));
      greeting.push(message("K", key), readyForQuery("I"));
      this.write(Buffer.concat(greeting));
      this.state = "idle";
      if (this.sbuf.length) {
        const more = this.sbuf;
        this.sbuf = Buffer.alloc(0);
        this.onData(more);
      }
      return;
    }
  }
  onClose(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.pooler.clients.delete(this);
    const b = this.backend;
    this.backend = null;
    // the linked DbHandler goes down with a client that leaves while holding its backend
    if (b && b.client === this) b.destroy();
  }
}

export class Pooler {
  target: BackendTarget;
  poolSize: number;
  ids = 0;
  all = new Set<Backend>();
  idle: Backend[] = [];
  waiters: { resolve: (b: Backend) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  opening = 0;
  clients = new Set<Client>();
  parameters = new Map<string, string>();
  hole: RegExp | null = null;
  server!: net.Server;
  port = 0;
  stats: PoolerStats = { clients: 0, checkouts: 0, releases: 0, releasedOwing: 0, droppedMsgs: 0, misdeliveredMsgs: 0, blackholedMsgs: 0, frozenChunks: 0, backendsOpened: 0 };

  constructor(o: { backend: BackendTarget; poolSize?: number }) {
    this.target = o.backend;
    this.poolSize = o.poolSize ?? 15;
  }

  async open(): Promise<Backend> {
    const b = new Backend(this);
    this.opening++;
    try {
      await b.connect();
    } finally {
      this.opening--;
    }
    if (!this.parameters.size) for (const [k, v] of b.params) this.parameters.set(k, v);
    this.all.add(b);
    return b;
  }
  grow(): void {
    while (this.waiters.length > this.opening && this.all.size + this.opening < this.poolSize) {
      this.open().then(
        (b) => this.checkin(b),
        (e: Error) => {
          const w = this.waiters.shift();
          if (w) {
            clearTimeout(w.timer);
            w.reject(e);
          }
        },
      );
    }
  }
  checkout(): Promise<Backend> {
    this.stats.checkouts++;
    const b = this.idle.pop(); // last in, first out
    if (b) return Promise.resolve(b);
    return new Promise((resolve, reject) => {
      const w = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error("Unable to check out process from the pool due to timeout"));
        }, 15_000),
      };
      this.waiters.push(w);
      this.grow();
    });
  }
  checkin(b: Backend): void {
    if (b.closed) return this.grow();
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      return w.resolve(b);
    }
    this.idle.push(b);
  }
  cancel(fakePid: number, fakeSecret: number): void {
    const b = [...this.clients].find((x) => x.fakePid === fakePid && x.fakeSecret === fakeSecret)?.backend;
    if (!b) return;
    const s = net.connect({ host: this.target.host, port: this.target.port }, () => {
      const m = Buffer.alloc(16);
      m.writeInt32BE(16, 0);
      m.writeInt32BE(80877102, 4);
      m.writeInt32BE(b.pid, 8);
      m.writeInt32BE(b.secret, 12);
      s.end(m);
    });
    s.on("error", () => {});
  }
  /** Drop, forever, every answer to the client whose next Parse or Query text matches `re`. */
  blackhole(re: RegExp): void {
    this.hole = re;
  }
  /** Stop forwarding anything on the client sockets open now, without closing them. */
  freezeAll(): void {
    for (const c of this.clients) c.frozen = true;
  }
  /** Backends that are not in the pool. */
  get busy(): number {
    return this.all.size - this.idle.length;
  }
  async close(): Promise<void> {
    for (const c of this.clients) c.sock.destroy();
    for (const b of [...this.all]) b.destroy();
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error("pooler closing"));
    }
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

/** Start a pooler in front of `backend` (one backend logged in first, as Supavisor keeps its minimum). */
export async function startPooler(o: { backend: BackendTarget; poolSize?: number }): Promise<Pooler> {
  const p = new Pooler(o);
  p.checkin(await p.open());
  p.server = net.createServer((sock) => {
    p.clients.add(new Client(p, sock));
  });
  await new Promise<void>((resolve, reject) => {
    p.server.once("error", reject);
    p.server.listen(0, "127.0.0.1", () => resolve());
  });
  p.port = (p.server.address() as net.AddressInfo).port;
  return p;
}

/** The backend of a postgres:// URL (the pooler logs in with its user and password). */
export function backendOf(url: string): BackendTarget {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) || "postgres" };
}
