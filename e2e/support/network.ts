import { createServer, request as httpRequest } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';

/**
 * A browser context's network, switched off below the browser. The context sends everything through
 * this local proxy (`browser.newContext({ proxy: { server } })`), which passes it on while on, and
 * while off drops every open connection and refuses new ones. Playwright's offline mode and its
 * routes attach to a page a moment after a reload, so a request made in that moment still went out
 * (seen on CI twice, D-64); a proxy is set on the context before any page exists, so this holds for
 * the page, its service worker and Realtime alike, from the first byte.
 */
export interface NetworkSwitch {
  /** The proxy's address, for the context's `proxy.server`. */
  server: string;
  set(online: boolean): void;
  close(): Promise<void>;
}

export async function networkSwitch(): Promise<NetworkSwitch> {
  let online = true;
  const open = new Set<Socket>();
  const keep = (s: Socket) => {
    open.add(s);
    s.on('close', () => open.delete(s));
    s.on('error', () => s.destroy());
  };

  // Plain http (the preview is https, so this is only for completeness).
  const server = createServer((req, res) => {
    if (!online || !req.url) return void res.socket?.destroy();
    const upstream = httpRequest(
      req.url,
      { method: req.method, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.socket?.destroy());
    req.pipe(upstream);
  });
  server.on('connection', keep);
  // https and wss: a tunnel to the host, while the network is on.
  server.on('connect', (req, client: Socket, head: Buffer) => {
    const [host, port] = (req.url ?? '').split(':');
    if (!online || !host) return void client.destroy();
    const upstream = connect(Number(port) || 443, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    keep(upstream);
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server: `http://127.0.0.1:${port}`,
    set(on) {
      online = on;
      if (!on) for (const s of open) s.destroy();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of open) s.destroy();
        server.close(() => resolve());
      }),
  };
}
