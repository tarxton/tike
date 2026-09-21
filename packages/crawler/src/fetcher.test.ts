import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError } from './errors';
import { PoliteFetcher } from './fetcher';

/**
 * A local server that hangs up on chosen requests, standing in for a shop whose
 * connection drops mid-crawl.
 */
let server: Server;
let base: string;
const hangUps = new Map<string, number>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const left = hangUps.get(req.url ?? '') ?? 0;
    if (left > 0) {
      hangUps.set(req.url!, left - 1);
      req.socket.destroy();
      return;
    }
    if (req.url === '/robots.txt') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok ${req.url}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe.each(['fetch', 'curl'] as const)('PoliteFetcher over %s', (transport) => {
  const fetcher = () => new PoliteFetcher(base, 0, transport, 10);

  it('asks again when the connection is dropped', async () => {
    // One reset used to throw out of the fetcher and end a whole crawl.
    hangUps.set(`/flaky-${transport}`, 1);
    const f = fetcher();
    await f.init();
    await expect(f.get(`${base}/flaky-${transport}`)).resolves.toBe(`ok /flaky-${transport}`);
  });

  it('gives up with a FetchError the crawl can count, not an exception that ends it', async () => {
    hangUps.set(`/dead-${transport}`, 10);
    const f = fetcher();
    await f.init();
    const failure = await f.get(`${base}/dead-${transport}`).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(FetchError);
    expect((failure as FetchError).status).toBe(0);
    expect((failure as FetchError).message).toMatch(/^no response from/);
  });

  it('keeps going after giving up on one page', async () => {
    hangUps.set(`/gone-${transport}`, 10);
    const f = fetcher();
    await f.init();
    await f.get(`${base}/gone-${transport}`).catch(() => undefined);
    await expect(f.get(`${base}/next-${transport}`)).resolves.toBe(`ok /next-${transport}`);
  });
});
