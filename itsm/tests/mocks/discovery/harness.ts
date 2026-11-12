// The mock harness of the discovery tests (design A §17). A mock tool is a request handler `(req: Request) =>
// Response`, served two ways: in process behind a connector's address (`mountMocks`: requests to https://<host>/…
// reach the host's handler through the connector transport, so every check the connector makes above the transport
// still applies), or on a node:http server on 127.0.0.1 for clients that need a socket (the relay, the bank
// simulation). DA1 part 2 adds the TLS server with the fixture CA (tests/fixtures/discovery-ca).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setDiscoveryTransport } from "@server/modules/discovery/net";

export type Handler = (req: Request) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Put mock tools behind host names; a host without a mock fails like one that does not answer. */
export function mountMocks(byHost: Record<string, Handler>): () => void {
  setDiscoveryTransport(async (url, init) => {
    const h = byHost[new URL(url).hostname.toLowerCase()];
    if (!h) throw new TypeError("fetch failed");
    return h(new Request(url, init));
  });
  return () => setDiscoveryTransport(null);
}

/** Serve a handler on 127.0.0.1 (a free port). */
export async function serve(handler: Handler): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const r = await handler(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }));
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500);
      res.end(String((e as Error)?.message ?? e));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
