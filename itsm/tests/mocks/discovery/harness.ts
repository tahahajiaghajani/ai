// The mock harness of the discovery tests (design A §17). A mock tool is a request handler `(req: Request) =>
// Response`, served two ways: in process behind a connector's address (`mountMocks`: requests to https://<host>/…
// reach the host's handler through the connector transport, so every check the connector makes above the transport
// still applies — names resolve to a documentation address the web version counts as public), or on a real socket on
// 127.0.0.1 (`serve`, plain http; `serveTls`, https with a certificate of the fixture CA, tests/fixtures/discovery-ca)
// for clients that need one: the TLS tests, the relay, the bank simulation.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { discoveryNet, resetDiscoveryNet, setDiscoveryTransport } from "@server/modules/discovery/net";
import { fixtureCa } from "../../fixtures/discovery-ca";

export type Handler = (req: Request) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** The address a mock tool's name resolves to while mounted (TEST-NET-3: public under the web version's rules). */
export const MOCK_ADDRESS = "203.0.113.10";

export interface MountOptions {
  /** what a name resolves to (default: MOCK_ADDRESS for every name) */
  addresses?: Record<string, string[]>;
}

/**
 * Put mock tools behind host names; a host without a mock fails like one that does not answer. While mounted, every
 * name resolves to MOCK_ADDRESS (or to `opts.addresses[name]`).
 */
export function mountMocks(byHost: Record<string, Handler>, opts: MountOptions = {}): () => void {
  const lookup = discoveryNet.lookup;
  discoveryNet.lookup = async (host: string) => opts.addresses?.[host.toLowerCase()] ?? [MOCK_ADDRESS];
  setDiscoveryTransport(async (url, init) => {
    const h = byHost[new URL(url).hostname.toLowerCase()];
    if (!h) throw new TypeError("fetch failed");
    return h(new Request(url, init));
  });
  return () => {
    setDiscoveryTransport(null);
    discoveryNet.lookup = lookup;
    resetDiscoveryNet();
  };
}

/** A node:http request handler around a mock tool's handler. */
function nodeHandler(handler: Handler, scheme: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const r = await handler(new Request(`${scheme}://${req.headers.host}${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }));
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500);
      res.end(String((e as Error)?.message ?? e));
    }
  };
}

/** Serve a handler on 127.0.0.1 (a free port). */
export async function serve(handler: Handler): Promise<{ url: string; port: number; close(): Promise<void> }> {
  const server = createServer(nodeHandler(handler, "http"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Serve a handler over TLS on 127.0.0.1 (a free port) with a certificate of the fixture CA (default: tool.bank.test). */
export async function serveTls(handler: Handler, tlsOpts: { cert?: string; key?: string } = {}): Promise<{ port: number; requests: { host: string | undefined; authorization: string | undefined }[]; close(): Promise<void> }> {
  const requests: { host: string | undefined; authorization: string | undefined }[] = [];
  const inner = nodeHandler(handler, "https");
  const server = createHttpsServer({ cert: tlsOpts.cert ?? fixtureCa().tool.pem, key: tlsOpts.key ?? fixtureCa().tool.key }, (req, res) => {
    requests.push({ host: req.headers.host, authorization: req.headers.authorization });
    void inner(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
